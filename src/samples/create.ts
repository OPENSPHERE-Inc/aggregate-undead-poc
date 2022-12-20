import {Logger, SymbolService} from "../services";
import prompts from "prompts";
import {symbolService, necromancyService, cosign} from "./common";
import {Account, Address, UInt64} from "symbol-sdk";
import * as fs from "fs";


const filePath = "./undead.json";

const main = async () => {
    const inputData = (await prompts([
        {
            type: "password",
            name: "signerPrivateKey",
            message: "Signer's Private Key?",
            stdout: process.stderr,
            validate: (value) => !value ? "This field is required." : true,
        }, {
            type: "text",
            name: "recipientAddress",
            message: "Recipient Address?",
            stdout: process.stderr,
            validate: (value) => !value ? "This field is required." : true,
        }, {
            type: "number",
            name: "transferAmountXYM",
            message: "Transfer Amount (in XYM)?",
            stdout: process.stderr,
            float: true,
            round: 6,
            min: 0.000001,
            max: 50000,
            increment: 0.000001,
            initial: 1,
            validate: (value) => !value ? "This field is required." : true,
        }, {
            type: "number",
            name: "deadlineDays",
            message: "Deadline Days?",
            stdout: process.stderr,
            min: 1,
            max: 30,
            initial: 1,
            validate: (value) => !value ? "This field is required." : true,
        }, {
            type: "text",
            name: "message",
            message: "Message [enter:skip]?",
            stdout: process.stderr,
        }
    ]));

    const { networkType } = await symbolService.getNetwork();
    const senderAccount = Account.createFromPrivateKey(inputData.signerPrivateKey, networkType);
    Logger.info(`Signer's address is ${senderAccount.address.plain()}`);
    const recipientAddress = Address.createFromRawAddress(inputData.recipientAddress);
    const cosignerAccounts = await cosign();

    const transferTx = await symbolService.createTransferTx(
        senderAccount.publicAccount,
        recipientAddress,
        UInt64.fromUint(inputData.transferAmountXYM * 1000000),
        inputData.message,
    );

    const undeadTx = await necromancyService.createTx(
        inputData.deadlineDays * 24,
        [ transferTx ],
        senderAccount,
        cosignerAccounts,
    );
    Logger.info(
        `Created ${undeadTx.signatures.length} signatures, ` +
        `transaction fee will be ${SymbolService.toXYM(undeadTx.aggregateTx.maxFee)} XYM.`
    );

    fs.writeFileSync("./undead.json", JSON.stringify(undeadTx.toJSON()), "utf-8");
    Logger.info(`${filePath}: JSON created. Now you can cast it by "undead-cast undead.json" anytime.`);
};

main()
    .catch((e) => {
        Logger.error(e);
        process.exit(1);
    });