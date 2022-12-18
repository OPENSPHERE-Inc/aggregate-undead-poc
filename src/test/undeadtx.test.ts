import dotenv from "dotenv";
dotenv.config({ path: './.env.test' });

import {AggregateUndeadTransaction, NecromancyService} from "../services";
import {SymbolService, SymbolTest} from "symbol-service";
import {
    Account,
    CosignatureTransaction,
    MetadataType,
    PublicAccount,
    SignedTransaction,
    UInt64
} from "symbol-sdk";
import assert from "assert";


describe("AggregateUndeadTransaction", () => {
    let necromancyService: NecromancyService;
    let symbolService: SymbolService;
    let targetAccount: Account;
    let undeadTx: AggregateUndeadTransaction;

    beforeAll(async () => {
        symbolService = SymbolTest.init();
        necromancyService = new NecromancyService(symbolService);

        const { networkType } = await symbolService.getNetwork();
        targetAccount = Account.generateNewAccount(networkType);
        console.log(
            `targetAccount.address=${targetAccount.address.plain()}\n` +
            `  .publicKey=${targetAccount.publicKey}\n` +
            `  .privateKey=${targetAccount.privateKey}\n`
        );
    }, 600000);

    const createTransactions = async (key: string, value: string = "test", message: string = "test") => {
        const { signerAccount, payerAccount } = await SymbolTest.getNamedAccounts();
        return [
            await symbolService.createMetadataTx(
                MetadataType.Account,
                signerAccount.publicAccount,
                targetAccount.publicAccount,
                undefined,
                key,
                value,
            ),
            await symbolService.createTransferTx(
                signerAccount.publicAccount,
                payerAccount.address,
                UInt64.fromUint(1000000),
                message,
            )
        ];
    };

    const announceSignedTxWithCosigners = async (signedTx: SignedTransaction, cosigners: Account[]) => {
        const { networkType } = await symbolService.getNetwork();
        const signerPubAccount = PublicAccount.createFromPublicKey(signedTx.signerPublicKey, networkType);
        const cosignatures = cosigners.map((cosigner) => CosignatureTransaction.signTransactionHash(cosigner, signedTx.hash));
        await symbolService.announceTxWithCosignatures(signedTx, cosignatures);
        return (await symbolService.waitTxsFor(signerPubAccount, signedTx.hash, "confirmed")).shift();
    };

    it("Create", async () => {
        const { signerAccount } = await SymbolTest.getNamedAccounts();
        undeadTx = await necromancyService.createTx(
            4 * 24,
            await createTransactions("test1key"),
            signerAccount,
            [ targetAccount ],
            0.1,
            1,
        );

        expect(undeadTx.signatures.length).toBe(Math.ceil(4 * 24 / 5));
    }, 600000);

    it("Serialize", async () => {
        const json = undeadTx.toJSON();
        const restoredUndeadTx = AggregateUndeadTransaction.createFromJSON(json);

        expect(restoredUndeadTx).toStrictEqual(undeadTx);
    }, 600000);

    it("Pick and cast", async () => {
        const { signedTx, signature } = await necromancyService.pickTx(undeadTx);

        expect(signedTx).toBeDefined();
        expect(signature).toBeDefined();
        // Expect picking 1st signature.
        expect(signature).toStrictEqual(undeadTx.signatures[0]);

        assert(signedTx);
        const result = await announceSignedTxWithCosigners(signedTx, []);

        expect(result?.error).toBeUndefined();
    }, 600000);

    it("Overlapped", async () => {
        // Forward 4.5 hours
        const { signerAccount } = await SymbolTest.getNamedAccounts();
        undeadTx = await necromancyService.createTx(
            4 * 24,
            await createTransactions("test2key"),
            signerAccount,
            [],
            0.1,
            1,
            undefined,
            4.5 * 60 * 60
        );

        const { signedTx, signature } = await necromancyService.pickTx(undeadTx, [ targetAccount ]);

        expect(signedTx).toBeDefined();
        expect(signature).toBeDefined();
        // Expect picking 2nd signature.
        expect(signature).toStrictEqual(undeadTx.signatures[1]);

        assert(signedTx);
        const result = await announceSignedTxWithCosigners(signedTx, []);

        expect(result?.error).toBeUndefined();
    }, 600000);

    it("Block duplicated announce", async () => {
        undeadTx = necromancyService.cosignTx(undeadTx, [ targetAccount ]);

        // Backward 1 hour
        const { signedTx, signature } = await necromancyService.pickTx(
            undeadTx,
            [],
            60 * 60
        );

        expect(signedTx).toBeDefined();
        expect(signature).toBeDefined();
        // Expect picking 1st signature.
        expect(signature).toStrictEqual(undeadTx.signatures[0]);

        assert(signedTx && signature);
        const result = await announceSignedTxWithCosigners(signedTx, []);

        // This must be failed.
        expect(result?.error).toBeDefined();
    }, 600000);

    it("Deadline too far error", async () => {
        const { signerAccount } = await SymbolTest.getNamedAccounts();
        undeadTx = await necromancyService.createTx(
            4 * 24,
            await createTransactions("test3key"),
            signerAccount,
            [],
            0.1,
            1
        );

        // Forward 10 hours
        const { signedTx, signature } = await necromancyService.pickTx(undeadTx, [],-10 * 60 * 60);

        expect(signedTx).toBeDefined();
        // Expect picking 3rd signature
        expect(signature).toStrictEqual(undeadTx.signatures[2]);

        assert(signedTx);
        const result = await announceSignedTxWithCosigners(signedTx, [ targetAccount ]);

        // This must be failed.
        expect(result?.error).toBeDefined();
    }, 600000);

    it("Expired", async () => {
        // Forward 4.5 hours
        const { signerAccount } = await SymbolTest.getNamedAccounts();
        undeadTx = await necromancyService.createTx(
            4 * 24,
            await createTransactions("test4key"),
            signerAccount,
            [],
            0.1,
            1,
            undefined,
            4 * 24 * 60 * 60 + 1
        );

        const { signedTx, signature } = await necromancyService.pickTx(undeadTx, [ targetAccount ]);

        expect(signedTx).toBeDefined();
        expect(signature).toBeDefined();
        // Expect picking 1st signature.
        expect(signature).toStrictEqual(undeadTx.signatures[undeadTx.signatures.length - 1]);

        assert(signedTx);
        const result = await announceSignedTxWithCosigners(signedTx, []);

        // This must be failed.
        expect(result?.error).toBeDefined();
    }, 600000);
})