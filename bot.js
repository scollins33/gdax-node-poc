/* ------------------------------------------
        REQUIRED PACKAGES
   ------------------------------------------ */
const { AuthenticatedClient } = require('gdax');
const fs = require('fs');
const express = require('express');
const moment = require('moment');


/* ------------------------------------------
        IMPORT CLASSES
   ------------------------------------------ */
const Currency = require('./classes/currency');
const Transaction = require('./classes/transaction');
const Datum = require('./classes/datum');


/* ------------------------------------------
        SCRIPT STARTUP CHECKS
   ------------------------------------------ */
const SHORT_PERIODS = parseInt(process.argv[2]);
const LONG_PERIODS = parseInt(process.argv[3]);

if (isNaN(SHORT_PERIODS) || isNaN(LONG_PERIODS)) {
    console.log(`[HELP] Proper usage:  node bot.js short_period long_period`);
    process.exit(1);
}
else if (SHORT_PERIODS >= LONG_PERIODS) {
    console.log(`[HELP] Short Periods must be less than Long Periods`);
    process.exit(1);
}
else if (SHORT_PERIODS > 2899 || LONG_PERIODS > 2900) {
    console.log(`[HELP] Moving average lengths cannot exceed 2900`);
    process.exit(1);
}

const keychain = JSON.parse(fs.readFileSync('keychain.txt', 'utf8'));


/* ------------------------------------------
        GLOBALS
   ------------------------------------------ */

// Create the Authorized Client
const authedClient = new AuthenticatedClient(
    keychain.key,
    keychain.secret,
    keychain.passphrase,
    'https://api.gdax.com'
);

// Create the currencies
const BTC = new Currency('Bitcoin', 'BTC-USD', keychain.btcAccount);
const ETH = new Currency('Ethereum', 'ETH-USD', keychain.ethAccount);

let totalProfit = 0;
let totalFees = 0;


/* ------------------------------------------
        BOT START UP CHECKS
   ------------------------------------------ */
// Check for backup and logs folders, then create them if missing
if (!fs.existsSync('./backup')) { fs.mkdirSync('./backup'); }
if (!fs.existsSync('./logs')) { fs.mkdirSync('./logs'); }

// create logs file if needed and start logging stream
if (!fs.existsSync('./logs/debug.txt')) {
    fs.closeSync(fs.openSync('./logs/debug.txt', 'w'));
}
const logger = fs.createWriteStream('./logs/debug.txt');

// Check for backup and load it
if (fs.existsSync('./backup/archive.txt')) {
    logit(logger, '[STARTUP] Found backup file, setting ARCHIVE to backup and updating BLOCKID');
    ARCHIVE = JSON.parse(fs.readFileSync('./backup/archive.txt', 'utf8'));
    BLOCKID = ARCHIVE[0].blockID;
    BLOCKID++;
    currentBlock.blockID = BLOCKID;
}

// Check for bobData and create it if not
if (!fs.existsSync('./logs/bobData.csv')) {
    const bobHeaders = `Block_ID,Start_Time,Number_Matches,Volume,Summation_Strike_Price,Weighted_Average,Low,High,Bid_Price,Ask_Price,\n`;
    fs.appendFile('./logs/bobData.csv', bobHeaders, (err) => { if (err) throw err; });
}


/* ------------------------------------------
        START EXPRESS SERVER
   ------------------------------------------ */
const app = express();
app.get('/', (req, res) => {
    res.send(generatePage());
});

app.get('/debug', (req, res) => {
    res.download('/logs/debug.txt', 'debug.txt', { root: __dirname });
});

app.listen(8080, () => logit(logger, '[WEB] App listening on 8080'));


/* ------------------------------------------
        BOT CORE LOGIC
   ------------------------------------------ */

// Spawn the WebSocket connection info and start getting data
logit(logger, `[STARTUP] Running bot using ${SHORT_PERIODS} and ${LONG_PERIODS}`);
// startWebsocket();

// Create interval to store data, reset block, and report current status
setInterval(() => {
    // Promise chain to handle logic
    handleBlock()
    // .then(() => writeBackup())
        .then(() => calcAverages())
        .then(averages => decideAction(averages))
        .then(decision => handleAction(decision))
        .then(result => {
            logit(logger, result);
            logit(logger, '* ------------------------------------------ *');
        })
        .catch((err) => {
            if (err.action) {
                logit(logger, `[Promise Chain] Error.action: ${err.action}`);
                logit(logger, `[Promise Chain] Error.message: ${err.message}`);
                logit(logger, '* ------------------------------------------ *');
            }
            else {
                logit(logger, `[Promise Chain] Error: ${err}`);
                logit(logger, '* ------------------------------------------ *');
            }
        });
}, 30000);


/* ------------------------------------------
        HELPER FUNCTIONS
   ------------------------------------------ */

// Helper function to consolelog and writelog
function logit (pStream, pMessage) {
    console.log(`${moment().format('MM/DD/YYYY HH:mm:ss SSS')} | ${pMessage}`);
    pStream.write(`${moment().format('MM/DD/YYYY HH:mm:ss SSS')} | ${pMessage} \n`);
}

// Helper to write backup of archive
function writeBackup () {
    logit(logger, `[writeBackup] Entering writeBackup`);
    fs.writeFile('./backup/btc_data.txt', JSON.stringify(BTC.data), 'utf8', (err) => {
        if (err) { logit(logger, `[writeBackup] ${err}`); }
    });

    fs.writeFile('./backup/btc_txn.txt', JSON.stringify(BTC.txn), 'utf8', (err) => {
        if (err) { logit(logger, `[writeBackup] ${err}`); }
    });

    fs.writeFile('./backup/eth_data.txt', JSON.stringify(ETH.data), 'utf8', (err) => {
        if (err) { logit(logger, `[writeBackup] ${err}`); }
    });

    fs.writeFile('./backup/eth_txn.txt', JSON.stringify(ETH.txn), 'utf8', (err) => {
        if (err) { logit(logger, `[writeBackup] ${err}`); }
    });
}

// Deal with storage of the block and catch empty/trouble blocks in case of connection loss
function handleBlock () {
    return new Promise((resolve, reject) => {
        logit(logger, `[handleBlock] Entering handleBlock`);

        // @TODO need to handle case of empty/failed fetch
        const btcPromise = authedClient.getProductOrderBook(BTC.ticker)
            .then(data => {
                const point = new Datum(data);

                BTC.addData(point);
                if (BTC.data.length > 2900) { BTC.removeData(); }

                return true;
            })
            .catch((err) => logit(logger, `[BTC GET] ${err}`));

        const ethPromise = authedClient.getProductOrderBook(ETH.ticker)
            .then(data => {
                const point = new Datum(data);

                ETH.addData(point);
                if (BTC.data.length > 2900) { ETH.removeData(); }

                return true;
            })
            .catch(err => logit(logger, `[ETH GET] ${err}`));

        Promise.all([btcPromise, ethPromise])
            .then(values => resolve(true))
            .catch(err => {
                logit(logger, `[ALL GET] ${err}`);
                reject(err);
            });
    });
}

// Compute and compare moving averages, report on current trend
function calcAverages () {
    return new Promise((resolve, reject) => {
        logit(logger, `[calcAverages] Entering calcAverages`);

        // create the trailing arrays
        const btc_short = BTC.data.slice(0,SHORT_PERIODS);
        const btc_long = BTC.data.slice(0,LONG_PERIODS);

        const eth_short = ETH.data.slice(0,SHORT_PERIODS);
        const eth_long = ETH.data.slice(0,LONG_PERIODS);

        let btc_short_total = null;
        let btc_long_total = null;
        let btc_short_avg = null;
        let btc_long_avg = null;

        let eth_short_total = null;
        let eth_long_total = null;
        let eth_short_avg = null;
        let eth_long_avg = null;

        // if we have a position look at the asks
        if (BTC.status) {
            logit(logger, `[calcAverages] BTC.status = true >> looking at ASKS`);
            btc_short_total = btc_short.reduce((sum, cur) => { return sum + cur.ask; }, 0);
            btc_long_total = btc_long.reduce((sum, cur) => { return sum + cur.ask; }, 0);
            btc_short_avg = Math.round(btc_short_total / SHORT_PERIODS * 100) / 100;
            btc_long_avg = Math.round(btc_long_total / LONG_PERIODS * 100) / 100;
        }
        // if we do not, look at the bids
        else {
            logit(logger, `[calcAverages] BTC.status = false >> looking at BIDS`);
            btc_short_total = btc_short.reduce((sum, cur) => { return sum + cur.bid; }, 0);
            btc_long_total = btc_long.reduce((sum, cur) => { return sum + cur.bid; }, 0);
            btc_short_avg = Math.round(btc_short_total / SHORT_PERIODS * 100) / 100;
            btc_long_avg = Math.round(btc_long_total / LONG_PERIODS * 100) / 100;
        }

        logit(logger, `[calcAverages] BTC Short Total MA: ${btc_short_total}`);
        logit(logger, `[calcAverages] BTC Long Total  MA: ${btc_long_total}`);
        logit(logger, `[calcAverages] BTC Short Avg MA: ${btc_short_avg}`);
        logit(logger, `[calcAverages] BTC Long Avg  MA: ${btc_long_avg}`);

        // if we have a position look at the asks
        if (ETH.status) {
            logit(logger, `[calcAverages] ETH.status = true >> looking at ASKS`);
            eth_short_total = eth_short.reduce((sum, cur) => { return sum + cur.ask; }, 0);
            eth_long_total = eth_long.reduce((sum, cur) => { return sum + cur.ask; }, 0);
            eth_short_avg = Math.round(eth_short_total / SHORT_PERIODS * 100) / 100;
            eth_long_avg = Math.round(eth_long_total / LONG_PERIODS * 100) / 100;
        }
        // if we do not, look at the bids
        else {
            logit(logger, `[calcAverages] ETH.status = false >> looking at BIDS`);
            eth_short_total = eth_short.reduce((sum, cur) => { return sum + cur.bid; }, 0);
            eth_long_total = eth_long.reduce((sum, cur) => { return sum + cur.bid; }, 0);
            eth_short_avg = Math.round(eth_short_total / SHORT_PERIODS * 100) / 100;
            eth_long_avg = Math.round(eth_long_total / LONG_PERIODS * 100) / 100;
        }

        logit(logger, `[calcAverages] ETH Short Total MA: ${eth_short_total}`);
        logit(logger, `[calcAverages] ETH Long Total  MA: ${eth_long_total}`);
        logit(logger, `[calcAverages] ETH Short Avg MA: ${eth_short_avg}`);
        logit(logger, `[calcAverages] ETH Long Avg  MA: ${eth_long_avg}`);


        if (BTC.data.length > LONG_PERIODS && ETH.data.length > LONG_PERIODS) {
            resolve([
                btc_short_avg,
                btc_long_avg,
                eth_short_avg,
                eth_long_avg
            ]);
        } else {
            logit(logger, `[calcAverages] BTC initial ${BTC.initial} | havePosition ${BTC.status}`);
            logit(logger, `[calcAverages] ETH initial ${ETH.initial} | havePosition ${ETH.status}`);
            reject('Data History not long enough');
        }
    });
}

// Take in the last minute MAs and decide what to do
// avgArray format: [short, long]
function decideAction(avgArray) {
    return new Promise((resolve, reject) => {
        logit(logger, `[decideAction] Entering decideAction`);

        /*
            Short > Long = Market is going UP (want to have ETH), should have bought already
                --> properMove = True
                    --> if properMove True, we should buy ETH (havePosition False -> make it True)
                        >> check for InitialRound -> pass if it is
                        >> should look at USD and send BUY order to convert to ETH
                    --> if properMove True, we should hold ETH (havePosition True)
                        >> do nothing

            Short < Long = Market is going DOWN (want to have USD), should have sold already
                --> properMove = False
                    --> if properMove False, we should sell ETH (havePosition True -> make it False)
                        >> should look at ETH and send SELL order to convert to USD
                    --> if properMove False, we should hold USD (havePosition False)
                        >> do nothing

            Scenario Summary:
                True | True -> nothing
                True | False -> buy ETH
                False | True -> sell ETH
                False | False -> nothing
         */

        // create move set
        const BTC_move = avgArray[0] > avgArray[1];
        const ETH_move = avgArray[2] > avgArray[3];
        let BTC_action = null;
        let ETH_action = null;

        // Log the current status before the switch cases
        logit(logger, `[decideAction] BTC initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);
        logit(logger, `[decideAction] ETH initial ${ETH.initial} | properMove ${ETH_move} | havePosition ${ETH.status}`);

        // BTC Decision
        switch (BTC_move) {
            case true:
                if (BTC.initial === true) {
                    logit(logger, `[decideAction] BTC Ignored uptick since it's the initial round`);
                    BTC_action = { action: 'none', message: 'Initial Round'};
                    break;
                }

                if (BTC.status) {
                    logit(logger, `[decideAction] BTC Price is going UP and we HAVE a position -> do nothing`);
                    BTC_action = { action: 'none', message: 'Price UP + Have Position -> Do Nothing'};
                }
                else {
                    logit(logger, `[decideAction] BTC Price is going UP and we DO NOT HAVE a position -> buy BTC`);
                    BTC_action = { action: 'buy', message: 'Price UP + No Position -> BUY BTC'};
                }
                break;

            case false:
                if (BTC.initial === true) {
                    logit(logger, `[decideAction] BTC Flipped Initial Round to false so next uptick is a clean buy`);
                    BTC.initial = false;
                }

                if (BTC.status) {
                    logit(logger, `[decideAction] BTC Price is going DOWN and we HAVE a position -> sell BTC`);
                    BTC_action = { action: 'sell', message: 'Price DOWN + Have Position -> SELL BTC'};
                }
                else {
                    logit(logger, `[decideAction] BTC Price is going DOWN and we DO NOT HAVE a position -> do nothing`);
                    BTC_action = { action: 'none', message: 'Price DOWN + No Position -> Do Nothing'};
                }
                break;

            default:
                logit(logger, `[decideAction] BTC decideAction was called but situation could not be handled`);
                BTC_action = { action: 'error', message: 'No trade decision could be made, check logs'};
        }

        // ETH Decision
        switch (ETH_move) {
            case true:
                if (ETH.initial === true) {
                    logit(logger, `[decideAction] ETH Ignored uptick since it's the initial round`);
                    ETH_action = { action: 'none', message: 'Initial Round'};
                    break;
                }

                if (ETH.status) {
                    logit(logger, `[decideAction] ETH Price is going UP and we HAVE a position -> do nothing`);
                    ETH_action = { action: 'none', message: 'Price UP + Have Position -> Do Nothing'};
                }
                else {
                    logit(logger, `[decideAction] ETH Price is going UP and we DO NOT HAVE a position -> buy ETH`);
                    ETH_action = { action: 'buy', message: 'Price UP + No Position -> BUY ETH'};
                }
                break;

            case false:
                if (ETH.initial === true) {
                    logit(logger, `[decideAction] ETH Flipped Initial Round to false so next uptick is a clean buy`);
                    ETH.initial = false;
                }

                if (ETH.status) {
                    logit(logger, `[decideAction] ETH Price is going DOWN and we HAVE a position -> sell ETH`);
                    ETH_action = { action: 'sell', message: 'Price DOWN + Have Position -> SELL ETH'};
                }
                else {
                    logit(logger, `[decideAction] ETH Price is going DOWN and we DO NOT HAVE a position -> do nothing`);
                    ETH_action = { action: 'none', message: 'Price DOWN + No Position -> Do Nothing'};
                }
                break;

            default:
                logit(logger, `[decideAction] ETH decideAction was called but situation could not be handled`);
                ETH_action = { action: 'error', message: 'No trade decision could be made, check logs'};
        }

        resolve([BTC_action, ETH_action]);
    });
}

// check action decision and follow through on it
function handleAction (pDecisions) {
    return new Promise((resolve, reject) => {
        logit(logger, `[handleAction] Entering handleAction`);
        logit(logger, `[handleAction] Action: ${pDecisions[0].action}`);
        logit(logger, `[handleAction] Message: ${pDecisions[0].message}`);
        logit(logger, `[handleAction] Action: ${pDecisions[1].action}`);
        logit(logger, `[handleAction] Message: ${pDecisions[1].message}`);

        // BTC one
        const btcHandler = new Promise((resolve, reject) => {
            if (pDecisions[0].action === 'none' || pDecisions[0] === 'error') {
                reject(pDecisions[0].message);
                logit(logger, `[handleAction] BTC Breaking out of handleAction since nothing to do`);
            }
            else {
                // grab all relevant data, DRYs the code but is technically a little inefficient
                logit(logger, `[handleAction] BTC Gathering data from Authed Client`);
                Promise.all([
                    authedClient.getProductOrderBook(BTC.ticker),
                    authedClient.getAccount(keychain.usdAccount),
                    authedClient.getAccount(BTC.account),
                ])
                    .then(results => {
                        const orderBook = results[0];
                        const usdAccount = results[1];
                        const btcAccount = results[2];

                        logit(logger, JSON.stringify(orderBook));
                        logit(logger, JSON.stringify(usdAccount));
                        logit(logger, JSON.stringify(btcAccount));

                        switch (pDecisions[0].action) {
                            // Enter into Buy Logic
                            case 'buy':
                                logit(logger, `[handleAction] BTC Selected Buy case, creating buy order`);
                                const buyParams = {
                                    type: 'market',
                                    side: 'buy',
                                    product_id: BTC.ticker,
                                    funds: Math.round((usdAccount.available * 0.98) * 100) / 100,
                                };
                                logit(logger, JSON.stringify(buyParams));

                                // @TODO THESE NUMBERS ARE FOR 1 COIN BASICALLY, NOT USING USD ACCOUNT BALANCE
                                const buyPrice = Math.round(orderBook.asks[0][0] * 100) / 100;
                                const buyFee = Math.round((buyPrice * 0.003) * 100) / 100;
                                const buyTxn = new Transaction('buy', buyPrice, buyFee);
                                BTC.addTxn(buyTxn);

                                logit(logger, `[handleAction] BTC Paid USD @ ${buyTxn.price}/coin and ${buyTxn.fee} fee`);
                                logit(logger, `[handleAction] BTC Total Transactions: ${BTC.txn.length}`);
                                totalFees += buyFee;

                                // swap status to true since we bought
                                BTC.status = true;
                                logit(logger, `[handleAction] BTC havePosition is now ${BTC.status}`);
                                resolve(`[handleAction] BTC Purchase completely processed`);
                                break;

                            // Enter into Sell Logic
                            case 'sell':
                                logit(logger, `[handleAction] BTC Selected Sell case, creating sell order`);
                                const sellParams = {
                                    type: 'market',
                                    side: 'sell',
                                    product_id: BTC.ticker,
                                    size: btcAccount.available,
                                };
                                logit(logger, JSON.stringify(sellParams));

                                // @TODO THESE NUMBERS ARE FOR 1 COIN BASICALLY, NOT USING USD ACCOUNT BALANCE
                                const sellPrice = Math.round(orderBook.bids[0][0] * 100) / 100;
                                const sellFee = Math.round((sellPrice * 0.003) * 100) / 100;
                                const sellTxn = new Transaction('sell', sellPrice, sellFee);
                                BTC.addTxn(sellTxn);

                                logit(logger, `[handleAction] BTC Sold for USD @ ${sellTxn.price}/coin and ${sellTxn.fee} fee`);
                                logit(logger, `[handleAction] BTC Total Transactions: ${BTC.txn.length}`);
                                totalFees += sellFee;

                                // swap status to true since we sold
                                BTC.status = false;
                                logit(logger, `[handleAction] BTC havePosition is now ${BTC.status}`);


                                // Calculate the profit since we sold stuff
                                // use the transactions just to test each out
                                // @TODO this could be cleaner obviously
                                const boughtTxn = BTC.txn.slice(-2)[0];
                                const soldTxn = BTC.txn.slice(-1)[0];
                                const profit = soldTxn.price - soldTxn.fee - boughtTxn.price - boughtTxn.fee;
                                totalProfit += profit;

                                logit(logger, `[handleAction] BTC TX Profit: ${profit}`);
                                logit(logger, `[handleAction] BTC Total Profit: ${totalProfit}`);
                                logit(logger, `[handleAction] BTC Total Fees: ${totalFees}`);
                                resolve(`[handleAction] BTC Sale completely processed`);
                                break;

                            default:
                                reject(`[handleAction] BTC No action could be read from DecisionObject`);
                                break;
                        }
                    })
                    .catch(err => {
                        logit(logger, err)
                    });
            }
        });

        // ETH one
        const ethHandler = new Promise((resolve, reject) => {
            if (pDecisions[1].action === 'none' || pDecisions[1] === 'error') {
                reject(pDecisions[1].message);
                logit(logger, `[handleAction] ETH Breaking out of handleAction since nothing to do`);
            }
            else {
                // grab all relevant data, DRYs the code but is technically a little inefficient
                logit(logger, `[handleAction] ETH Gathering data from Authed Client`);
                Promise.all([
                    authedClient.getProductOrderBook(ETH.ticker),
                    authedClient.getAccount(keychain.usdAccount),
                    authedClient.getAccount(ETH.account),
                ])
                    .then(results => {
                        const orderBook = results[0];
                        const usdAccount = results[1];
                        const ethAccount = results[2];

                        logit(logger, JSON.stringify(orderBook));
                        logit(logger, JSON.stringify(usdAccount));
                        logit(logger, JSON.stringify(ethAccount));

                        switch (pDecisions[1].action) {
                            // Enter into Buy Logic
                            case 'buy':
                                logit(logger, `[handleAction] ETH Selected Buy case, creating buy order`);
                                const buyParams = {
                                    type: 'market',
                                    side: 'buy',
                                    product_id: ETH.ticker,
                                    funds: Math.round((usdAccount.available * 0.98) * 100) / 100,
                                };
                                logit(logger, JSON.stringify(buyParams));

                                // @TODO THESE NUMBERS ARE FOR 1 COIN BASICALLY, NOT USING USD ACCOUNT BALANCE
                                const buyPrice = Math.round(orderBook.asks[0][0] * 100) / 100;
                                const buyFee = Math.round((buyPrice * 0.003) * 100) / 100;
                                const buyTxn = new Transaction('buy', buyPrice, buyFee);
                                ETH.addTxn(buyTxn);

                                logit(logger, `[handleAction] ETH Paid USD @ ${buyTxn.price}/coin and ${buyTxn.fee} fee`);
                                logit(logger, `[handleAction] ETH Total Transactions: ${ETH.txn.length}`);
                                totalFees += buyFee;

                                // swap status to true since we bought
                                ETH.status = true;
                                logit(logger, `[handleAction] ETH havePosition is now ${ETH.status}`);
                                resolve(`[handleAction] ETH Purchase completely processed`);
                                break;

                            // Enter into Sell Logic
                            case 'sell':
                                logit(logger, `[handleAction] ETH Selected Sell case, creating sell order`);
                                const sellParams = {
                                    type: 'market',
                                    side: 'sell',
                                    product_id: ETH.ticker,
                                    size: ethAccount.available,
                                };
                                logit(logger, JSON.stringify(sellParams));

                                // @TODO THESE NUMBERS ARE FOR 1 COIN BASICALLY, NOT USING USD ACCOUNT BALANCE
                                const sellPrice = Math.round(orderBook.bids[0][0] * 100) / 100;
                                const sellFee = Math.round((sellPrice * 0.003) * 100) / 100;
                                const sellTxn = new Transaction('sell', sellPrice, sellFee);
                                ETH.addTxn(sellTxn);

                                logit(logger, `[handleAction] ETH Sold for USD @ ${sellTxn.price}/coin and ${sellTxn.fee} fee`);
                                logit(logger, `[handleAction] ETH Total Transactions: ${ETH.txn.length}`);
                                totalFees += sellFee;

                                // swap status to true since we sold
                                ETH.status = false;
                                logit(logger, `[handleAction] ETH havePosition is now ${ETH.status}`);


                                // Calculate the profit since we sold stuff
                                // use the transactions just to test each out
                                // @TODO this could be cleaner obviously
                                const boughtTxn = ETH.txn.slice(-2)[0];
                                const soldTxn = ETH.txn.slice(-1)[0];
                                const profit = soldTxn.price - soldTxn.fee - boughtTxn.price - boughtTxn.fee;
                                totalProfit += profit;

                                logit(logger, `[handleAction] ETH TX Profit: ${profit}`);
                                logit(logger, `[handleAction] ETH Total Profit: ${totalProfit}`);
                                logit(logger, `[handleAction] ETH Total Fees: ${totalFees}`);
                                resolve(`[handleAction] ETH Sale completely processed`);
                                break;

                            default:
                                reject(`[handleAction] ETH No action could be read from DecisionObject`);
                                break;
                        }
                    })
                    .catch(err => {
                        logit(logger, err)
                    });
            }
        });

        Promise.all([btcHandler, ethHandler])
            .then(values => resolve(true))
            .catch(err => {
                logit(logger, `[ALL GET] ${err}`);
                reject(err);
            });
    });
}

function generatePage() {
    logit(logger, `[generatePage] Entering generatePage`);
    const btc_snapshot = BTC.data.slice(0,12);
    const eth_snapshot = ETH.data.slice(0,12);

    let page = `<h1>CRYPTO BOT</h1>`;
    page += `<p>SHORT_PERIODS = ${SHORT_PERIODS}</p>`;
    page += `<p>LONG_PERIODS = ${LONG_PERIODS}</p>`;
    page += '<br>';
    page += `<p>Profit (total): ${totalProfit}</p>`;
    page += `<p>Fees (total): ${totalFees}</p>`;
    page += '<br>';

    page += '<h1>BTC Performance</h1>';
    page += `<p>Have position? ${BTC.status}</p>`;
    page += `<p>Initial round? ${BTC.initial}</p>`;
    page += `<p>Data Length: ${BTC.data.length}</p>`;
    page += `<p>Transactions: ${BTC.txn.length}</p>`;
    page += '<br>';

    btc_snapshot.forEach((each) => {
        page += `<p>${JSON.stringify(each)}</p>`;
    });
    page += '<br>';

    BTC.txn.forEach((each) => {
        page += `<p>Time: ${each.timestamp} | Type: ${each.type} | Price: ${each.price}  | Fees: ${each.fee}</p>`;
    });
    page += '<br>';

    page += '<h1>ETH Performance</h1>';
    page += `<p>Have position? ${ETH.status}</p>`;
    page += `<p>Initial round? ${ETH.initial}</p>`;
    page += `<p>Data Length: ${ETH.data.length}</p>`;
    page += `<p>Transactions: ${ETH.txn.length}</p>`;
    page += '<br>';

    eth_snapshot.forEach((each) => {
        page += `<p>${JSON.stringify(each)}</p>`;
    });
    page += '<br>';

    ETH.txn.forEach((each) => {
        page += `<p>Time: ${each.timestamp} | Type: ${each.type} | Price: ${each.price}  | Fees: ${each.fee}</p>`;
    });

    return page;
}
