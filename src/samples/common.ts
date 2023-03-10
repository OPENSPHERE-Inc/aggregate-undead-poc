import dotenv from "dotenv";
import assert from "assert";
import {NecromancyService, Logger, SymbolService} from "../services";
import prompts from "prompts";
import {Account} from "symbol-sdk";

dotenv.config({ path: './.env' });
Logger.init({ force_stderr: true, log_level: Logger.LogLevel.DEBUG });

assert(process.env.NODE_URL);
export const symbolService = new SymbolService({
    node_url: process.env.NODE_URL,
    fee_ratio: Number(process.env.FEE_RATIO || "0"),
    deadline_hours: 5,
});
export const necromancyService = new NecromancyService(symbolService);


export const cosign = async () => {
    const cosignerAccounts = new Array<Account>();
    let privateKey: string | undefined;
    const { networkType } = await symbolService.getNetwork();

    do {
        privateKey = (await prompts(
            {
                type: "password",
                name: "privateKey",
                message: `No.${cosignerAccounts.length + 1} Cosigner's Private Key [enter:skip]?`,
                stdout: process.stderr,
            }
        )).privateKey;
        if (privateKey) {
            const account = Account.createFromPrivateKey(privateKey, networkType);
            cosignerAccounts.push(account);
            Logger.info(`No.${cosignerAccounts.length} Cosigner's address is ${account.address.plain()}`);
        }
    } while (privateKey);

    return cosignerAccounts;
};