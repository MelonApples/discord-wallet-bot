"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const google_spreadsheet_1 = require("google-spreadsheet");
const discord_js_1 = require("discord.js");
const fs_1 = (0, tslib_1.__importDefault)(require("fs"));
require("dotenv/config");
const { writeFile } = fs_1.default.promises;
const solanaRegExp = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isSolanaAddress = (address) => solanaRegExp.test(address);
const getGiveaways = async () => {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_1 ||
        !process.env.GOOGLE_PRIVATE_KEY_1 ||
        !process.env.GOOGLE_GIVEAWAYS_SHEET_ID_1) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL_1, GOOGLE_PRIVATE_KEY_1 or GOOGLE_GIVEAWAYS_SHEET_ID_1 missing');
    }
    const doc = new google_spreadsheet_1.GoogleSpreadsheet(process.env.GOOGLE_GIVEAWAYS_SHEET_ID_1);
    const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_1;
    const private_key = process.env.GOOGLE_PRIVATE_KEY_1.replace(/\\n/g, '\n');
    // Authorize
    console.log('Authorizing with Google');
    await doc.useServiceAccountAuth({
        client_email,
        private_key,
    });
    // Load the document
    console.log('Loading giveaway spreadsheet');
    await doc.loadInfo();
    console.log('Giveaway spreadsheet loaded');
    const rows = await doc.sheetsByIndex[0].getRows();
    const giveaways = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        giveaways.push({
            id: row.id,
            from: row.from,
        });
    }
    return giveaways;
};
const createQueue = async () => {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_1 || !process.env.GOOGLE_PRIVATE_KEY_1 || !process.env.GOOGLE_SHEET_ID_1) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL_1, GOOGLE_PRIVATE_KEY_1 or GOOGLE_SHEET_ID_1 missing');
    }
    const doc = new google_spreadsheet_1.GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID_1);
    const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_1;
    const private_key = process.env.GOOGLE_PRIVATE_KEY_1.replace(/\\n/g, '\n');
    // Authorize
    console.log('Authorizing with Google');
    await doc.useServiceAccountAuth({
        client_email,
        private_key,
    });
    // Load the document
    console.log('Loading spreadsheet');
    await doc.loadInfo();
    console.log('Spreadsheet loaded');
    const sheet = doc.sheetsByIndex[0];
    const queue = [];
    setInterval(async () => {
        const walletSubmission = queue.shift();
        if (walletSubmission) {
            try {
                const { id, name, address } = walletSubmission;
                const now = new Date();
                const rows = await sheet.getRows();
                const idx = rows.findIndex((row) => row.id === id);
                if (idx > -1) {
                    // User already exists - update it
                    const row = rows[idx];
                    if (row.address !== address) {
                        console.log(`Updating user ${id} ${name} to wallet ${address}`);
                        row.name = name;
                        row.address = address;
                        row.updated = now.toISOString();
                        await row.save();
                    }
                }
                else {
                    // Add user and their wallet
                    console.log(`Adding user ${id} ${name} with wallet ${address}`);
                    await sheet.addRow({
                        id,
                        name,
                        address,
                        created: now.toISOString(),
                    });
                }
            }
            catch (err) {
                console.error(`${walletSubmission.id} ${walletSubmission.name} failed to save`);
            }
        }
        // Run every 4 seconds
    }, 4000);
    return queue;
};
const discordBot = async () => {
    if (!process.env.DISCORD_TOKEN_1 || !process.env.DISCORD_SERVER_ID_1 || !process.env.DISCORD_WHITELIST_ROLE_ID_1) {
        throw new Error('DISCORD_SERVER_ID_1, DISCORD_TOKEN_1 or DISCORD_WHITELIST_ROLE_ID_1 missing');
    }
    const TOKEN = process.env.DISCORD_TOKEN_1;
    const SERVER_ID = process.env.DISCORD_SERVER_ID_1;
    const WHITELIST_ROLE_ID = process.env.DISCORD_WHITELIST_ROLE_ID_1;
    const client = new discord_js_1.Client({
        intents: [
            discord_js_1.Intents.FLAGS.GUILDS,
            discord_js_1.Intents.FLAGS.GUILD_MESSAGES,
            discord_js_1.Intents.FLAGS.GUILD_MEMBERS,
            discord_js_1.Intents.FLAGS.GUILD_PRESENCES,
        ],
    });
    const queue = await createQueue();
    client.on('ready', async () => {
        console.log(`Logged in as ${client.user?.tag}!`);
        // Check every 4 hours
        setInterval(async () => {
            try {
                const giveaways = await getGiveaways();
                const members = await client.guilds.cache.get(SERVER_ID)?.members.fetch();
                if (members) {
                    for (let i = 0; i < giveaways.length; i++) {
                        const { id, from } = giveaways[i];
                        const member = members.get(id);
                        if (member && !member.roles.cache.some((role) => role.id === WHITELIST_ROLE_ID)) {
                            console.log(`Adding EarlyBird role to ${member.user.tag} from ${from}`);
                            member.roles.add(WHITELIST_ROLE_ID, `Giveaway from ${from}`);
                        }
                    }
                }
            }
            catch (err) {
                console.error('Giveaway interval failed', err);
            }
        }, 240 * 60000);
    });
    client.on('messageCreate', async (msg) => {
        const member = msg.member;
        if (member) {
            const content = msg.content.trim();
            const [command, address] = content.split(' ').filter((v) => !!v);
            const user = member.user;
            if (member.roles.cache.some((role) => role.id === WHITELIST_ROLE_ID)) {
                if (command === '!wallet') {
                    if (!address) {
                        msg.reply('Please provide Solana address. Example of correct command:\n!wallet REPLACE_THIS_WITH_YOUR_ADDRESS');
                    }
                    else if (!isSolanaAddress(address)) {
                        msg.reply('Invalid Solana address');
                    }
                    else {
                        msg.react('👍');
                        queue.push({
                            id: user.id,
                            name: user.tag,
                            address,
                        });
                    }
                }
                else if (content.startsWith('!wallet') && content.includes('\n')) {
                    msg.reply("Please don't use line breaks in your message. Example of correct command:\n!wallet REPLACE_THIS_WITH_YOUR_ADDRESS");
                }
            }
            // Allow users to check their presale token balance
            // if (process.env.PRESALE_TOKEN_ADDRESS_1) {
            //   if (command === '!checkwallet') {
            //     if (!address) {
            //       msg.reply('Please provide Solana address. Example of correct command:\n!checkwallet YOUR_ADDRESS');
            //     } else if (!isSolanaAddress(address)) {
            //       msg.reply('Invalid Solana address');
            //     } else {
            //       try {
            //         const { data } = await axios.get<SolscanToken[]>('https://public-api.solscan.io/account/tokens', {
            //           params: {
            //             account: address,
            //           },
            //         });
            //         const idx = data.findIndex((account) => account.tokenAddress === process.env.PRESALE_TOKEN_ADDRESS_1);
            //         msg.reply(
            //           idx > -1
            //             ? `Presale Token Balance: ${data[idx].tokenAmount.amount}`
            //             : "That wallet doesn't have a Presale Token account",
            //         );
            //       } catch (err: unknown) {
            //         console.error('checkwallet error', err);
            //         msg.reply('Request to Solana failed. Please try again later!');
            //       }
            //     }
            //   } else if (content.startsWith('!checkwallet') && content.includes('\n')) {
            //     msg.reply(
            //       "Please don't use line breaks in your message. Example of correct command:\n!checkwallet YOUR_ADDRESS",
            //     );
            //   }
            // }
        }
    });
    client.login(TOKEN);
};
const exportWallets = async () => {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_1 || !process.env.GOOGLE_PRIVATE_KEY_1 || !process.env.GOOGLE_SHEET_ID_1) {
        throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL_1, GOOGLE_PRIVATE_KEY_1 or GOOGLE_SHEET_ID_1 missing');
    }
    const doc = new google_spreadsheet_1.GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID_1);
    const client_email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL_1;
    const private_key = process.env.GOOGLE_PRIVATE_KEY_1.replace(/\\n/g, '\n');
    const tokensPerWallet = 3;
    // Authorize
    console.log('Authorizing with Google');
    await doc.useServiceAccountAuth({
        client_email,
        private_key,
    });
    // Load the document
    console.log('Loading spreadsheet');
    await doc.loadInfo();
    const rows = await doc.sheetsByIndex[0].getRows();
    const wallets = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.address?.length && isSolanaAddress(row.address)) {
            wallets.push([row.address, tokensPerWallet]);
        }
    }
    await writeFile('./wallets.json', JSON.stringify(wallets));
};
discordBot();
// exportWallets();
//# sourceMappingURL=index.js.map