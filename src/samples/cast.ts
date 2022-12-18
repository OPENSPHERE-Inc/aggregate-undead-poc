import {Logger, SymbolService} from "symbol-service";
import {cosign, necromancyService, symbolService} from "./common";
import * as fs from "fs";
import {AggregateUndeadTransaction} from "../services";
import prompts from "prompts";
import {PublicAccount} from "symbol-sdk";


const main = async () => {
    const filePath = process.argv[2];
    if (!filePath) {
        throw new Error("Input file wasn't specified.");
    } else if (!fs.existsSync(filePath)) {
        throw new Error(`${filePath}: File not found.`);
    }

    const cosignerAccounts = await cosign();
    const undeadTx = AggregateUndeadTransaction.createFromJSON(JSON.parse(fs.readFileSync(filePath, "utf-8")));

    const { signedTx, signature } = await necromancyService.pickTx(undeadTx, cosignerAccounts);
    if (!signedTx || !signature) {
        throw new Error("Couldn't pick undead transaction.");
    }

    Logger.info(
        `Announcing ${signedTx.hash} with fee ${SymbolService.toXYM(signature.maxFee)} XYM.`
    );
    const decision = (await prompts({
        type: "confirm",
        name: "decision",
        message: "Are you sure announce it?",
        initial: true,
    })).decision;
    if (!decision) {
        throw new Error("Canceled by user.");
    }

    await symbolService.announceTxWithCosignatures(signedTx, []);
    const { networkType } = await symbolService.getNetwork();
    const signerPubAccount = PublicAccount.createFromPublicKey(signedTx.signerPublicKey, networkType);
    const result = (await symbolService.waitTxsFor(signerPubAccount, signedTx.hash, "confirmed")).shift();
    if (result?.error) {
        throw new Error("Transaction failed.");
    } else {
        Logger.info("Completed.");
    }
};

main()
    .catch((e) => {
        Logger.error(e);
        process.exit(1);
    });