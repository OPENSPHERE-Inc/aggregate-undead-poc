import {
    Account,
    AggregateTransaction,
    AggregateTransactionCosignature,
    Convert,
    CosignatureSignedTransaction, CosignatureTransaction,
    Deadline,
    InnerTransaction,
    MetadataType,
    PublicAccount,
    UInt64
} from "symbol-sdk";

import {SymbolService} from "./symbol";
import assert from "assert";
import { v4 as uuidv4 } from "uuid";


export interface UndeadSignature {
    adjustedDeadline: number;
    hash: string;
    signature: string;
    maxFee: UInt64;
    cosignatures: CosignatureSignedTransaction[];
}

export class AggregateUndeadTransaction {
    constructor(
        public readonly publicKey: string,
        public readonly aggregateTx: AggregateTransaction,
        public readonly signatures: UndeadSignature[]
    ) {}

    public toJSON() {
        return {
            publicKey: this.publicKey,
            aggregateTxPayload: this.aggregateTx.serialize(),
            signatures: this.signatures.map((signature) => ({
                ...signature,
                // [ lower, higher ]
                maxFee: signature.maxFee.toDTO(),
                cosignatures: signature.cosignatures.map((cosignature) => ({
                    ...cosignature,
                    // [ lower, higher ]
                    version: cosignature.version.toDTO(),
                }))
            })),
        }
    }

    public static createFromJSON(json: any) {
        return new AggregateUndeadTransaction(
            json.publicKey,
            AggregateTransaction.createFromPayload(json.aggregateTxPayload),
            json.signatures.map((signature: any) => ({
                ...signature,
                // [ lower, higher ]
                maxFee: new UInt64(signature.maxFee),
                cosignatures: signature.cosignatures.map(
                    (cosignature: any) => new CosignatureSignedTransaction(
                        cosignature.parentHash,
                        cosignature.signature,
                        cosignature.signerPublicKey,
                        // [ lower, higher ]
                        new UInt64(cosignature.version),
                    )
                )
            })),
        );
    }
}

export interface NecromancyServiceConfig {
    deadlineUnitHours: number,
    deadlineMarginHours: number,
}

export class NecromancyService {

    private static defaultConfig = {
        deadlineUnitHours: 5,
        deadlineMarginHours: 1,
    };

    public constructor(
        private symbolService: SymbolService,
        private config: NecromancyServiceConfig = NecromancyService.defaultConfig
    ) {}

    // cosigners are optional.
    public async createTx(
        deadlineHours: number,
        innerTxs: InnerTransaction[],
        signerAccount: Account,
        cosignerAccounts: Account[] = [],
        feeRatio?: number,
        requiredCosigners: number = 1,
        nonce: UInt64 = SymbolService.generateKey(uuidv4()),
        timeShiftSecs: number = 0,
    ): Promise<AggregateUndeadTransaction> {
        if (innerTxs.length < 1) {
            throw new Error("Empty inner transactions.");
        }
        if (innerTxs.length > 99) {
            throw new Error("Number of inner transactions must be 99 or less.");
        }

        const { networkType, epochAdjustment } = await this.symbolService.getNetwork();
        const numExtends = Math.ceil(deadlineHours / this.config.deadlineUnitHours);
        const signatures = new Array<UndeadSignature>();
        let firstAggregateTx: AggregateTransaction | undefined;

        // Create lock metadata for prevent duplication
        const lockMetadata = await this.symbolService.createMetadataTx(
            MetadataType.Account,
            signerAccount.publicAccount,
            signerAccount.publicAccount,
            undefined,
            nonce,
            "1",
        );

        for (let i = 0; i < numExtends; i++) {
            const deadline = Deadline.create(
                epochAdjustment + timeShiftSecs,
                Math.min(this.config.deadlineUnitHours * (i + 1), deadlineHours)
            );
            const aggregateTx = AggregateTransaction.createComplete(
                deadline,
                // Insert lock metadata transaction
                [ ...innerTxs, lockMetadata ],
                networkType,
                [],
            ).setMaxFeeForAggregate(await this.symbolService.getFeeMultiplier(feeRatio), requiredCosigners);

            const { signature, hash } = await this.symbolService.signTx(signerAccount, aggregateTx);
            const cosignatures = cosignerAccounts.map(
                (cosigner) => CosignatureTransaction.signTransactionHash(cosigner, hash)
            );

            signatures.push({
                adjustedDeadline: deadline.adjustedValue,
                hash,
                maxFee: aggregateTx.maxFee,
                signature: Convert.uint8ToHex(signature),
                cosignatures,
            });

            if (!firstAggregateTx) {
                // Save only first life of aggregate tx.
                firstAggregateTx = aggregateTx;
            }
        }

        assert(firstAggregateTx);
        return new AggregateUndeadTransaction(
            signerAccount.publicKey,
            // Clear inner transaction's deadline (because it's garbage)
            AggregateTransaction.createFromPayload(firstAggregateTx.serialize()),
            signatures,
        );
    }

    public cosignTx(
        undeadTx: AggregateUndeadTransaction,
        cosignerAccounts: Account[],
    ): AggregateUndeadTransaction {
        const signatures = new Array<UndeadSignature>();

        for (const signature of undeadTx.signatures) {
            signatures.push({
                ...signature,
                cosignatures: [
                    ...signature.cosignatures,
                    ...cosignerAccounts.map(
                        (cosigner) => CosignatureTransaction.signTransactionHash(cosigner, signature.hash)
                    )
                ],
            })
        }

        return new AggregateUndeadTransaction(
            undeadTx.publicKey,
            undeadTx.aggregateTx,
            signatures,
        );
    }

    // cosigners are optional.
    public async pickAndCastTx(
        undeadTx: AggregateUndeadTransaction,
        cosignerAccounts: Account[] = [],
        timeShiftSecs: number = 0,
    ) {
        const { epochAdjustment } = await this.symbolService.getNetwork();
        const deadline = Deadline.create(epochAdjustment + timeShiftSecs, this.config.deadlineUnitHours);
        let recalledSignature: UndeadSignature | undefined;
        const marginMsecs = this.config.deadlineMarginHours * 60 * 60 * 1000;

        for (const signature of undeadTx.signatures) {
            if (signature.adjustedDeadline - marginMsecs > deadline.adjustedValue) {
                break;
            }
            recalledSignature = signature;
        }

        // Convert AggregateTransaction with cosignatures to SignedTransaction
        const toSignedTx = async (aggregateTx: AggregateTransaction, undeadSignature: UndeadSignature) => {
            const cosignatures = cosignerAccounts.map(
                (cosigner) => CosignatureTransaction.signTransactionHash(cosigner, undeadSignature.hash)
            );

            const aggregateTxCosignatures = [ ...undeadSignature.cosignatures, ...cosignatures ].map(
                (cosignature) =>
                    new AggregateTransactionCosignature(
                        cosignature.signature,
                        PublicAccount.createFromPublicKey(cosignature.signerPublicKey, aggregateTx.networkType)
                    )
            );

            return await this.symbolService.convertToSignedTx(new AggregateTransaction(
                aggregateTx.networkType,
                aggregateTx.type,
                aggregateTx.version,
                Deadline.createFromAdjustedValue(undeadSignature.adjustedDeadline),
                undeadSignature.maxFee,
                aggregateTx.innerTransactions,
                aggregateTxCosignatures,
                undeadSignature.signature,
                PublicAccount.createFromPublicKey(undeadTx.publicKey, aggregateTx.networkType),
            ));
        };

        return recalledSignature ? {
            signature: recalledSignature,
            signedTx: await toSignedTx(undeadTx.aggregateTx, recalledSignature),
        } : {};
    }

}