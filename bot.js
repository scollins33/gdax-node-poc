/* ------------------------------------------
        REQUIRED PACKAGES
   ------------------------------------------ */
const { WebsocketClient, AuthenticatedClient } = require('gdax');
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
else if (SHORT_PERIODS > 4319 || LONG_PERIODS > 4320) {
    console.log(`[HELP] Moving average lengths cannot exceed 4320`);
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
const BTC = new Currency('Bitcoin', 'BTC-USD');
const ETH = new Currency('Ethereum', 'ETH-USD');

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
    res.sendFile('./logs/debug.txt', { root : __dirname});
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
        .then(averages => makeTradeDecision(averages))
        .then(decision => handleTradeDecision(decision))
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
}, 5000);


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
    fs.writeFile('./backup/btc_archive.txt', JSON.stringify(BTC_DATA), 'utf8', (err) => {
        if (err) { logit(logger, `[writeBackup] ${err}`); }
    });

    fs.writeFile('./backup/eth_archive.txt', JSON.stringify(ETH_DATA), 'utf8', (err) => {
        if (err) { logit(logger, `[writeBackup] ${err}`); }
    });
}

// Deal with storage of the block and catch empty/trouble blocks in case of connection loss
function handleBlock () {
    return new Promise((resolve, reject) => {
        logit(logger, `[handleBlock] Entering handleBlock`);

        /*{
            "sequence": "3",
            "bids": [
                [ price, size, num-orders ],
            ],
            "asks": [
                [ price, size, num-orders ],
            ]
        }*/

        // @TODO need to handle case of empty/failed fetch
        const btcPromise = authedClient.getProductOrderBook(BTC.ticker)
            .then(data => {
                const point = new Datum(data);

                BTC.addData(point);
                if (BTC.data.length > 4320) { BTC.removeData(); }

                return true;
            })
            .catch((err) => logit(logger, `[BTC GET] ${err}`));

        // const eth = authedClient.getProductOrderBook("ETH-USD")
        //     .then(data => {
        //         return ETH_DATA.unshift({
        //             startTime: moment().format('MM/DD/YYYY HH:mm:ss'),
        //             sequence: data.sequence,
        //             bid: parseFloat(data.bids[0][0]),
        //             ask: parseFloat(data.asks[0][0]),
        //         });
        //     })
        //     .catch(err => logit(logger, `[ETH GET] ${err}`));
        //
        Promise.all([btcPromise])
            .then(values => resolve(true))
            .catch(err => logit(logger, `[ALL GET] ${err}`));
    });
}

// Compute and compare moving averages, report on current trend
function calcAverages () {
    return new Promise((resolve, reject) => {
        logit(logger, `[calcAverages] Entering calcAverages`);

        // create the trailing arrays
        const btc_short = BTC.data.slice(0,SHORT_PERIODS);
        const btc_long = BTC.data.slice(0,LONG_PERIODS);

        let btc_short_total = null;
        let btc_long_total = null;
        let btc_short_avg = null;
        let btc_long_avg = null;

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

        if (BTC.data.length > LONG_PERIODS) {
            resolve([
                btc_short_avg,
                btc_long_avg,
            ]);
        } else {
            logit(logger, `[calcAverages] initial ${BTC.initial} | havePosition ${BTC.status}`);
            reject('Data History not long enough');
        }
    });
}

// Take in the last minute MAs and decide what to do
// avgArray format: [short, long]
function makeTradeDecision(avgArray) {
    return new Promise((resolve, reject) => {
        logit(logger, `[makeTradeDecision] Entering makeTradeDecision`);

        // create move set
        const BTC_move = avgArray[0] > avgArray[1];

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

        // BTC Decision
        switch (BTC_move) {

            case true:
                // >> check for InitialRound -> pass if it is
                if (BTC.initial === true) {
                    logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);
                    logit(logger, `[makeTradeDecision] Ignored uptick since it's the initial round`);

                    reject({
                        action: 'none',
                        message: 'Initial Round',
                    });
                    return;
                }

                // True | True
                // --> if properMove True, we should hold ETH (havePosition True)
                    // >> do nothing
                if (BTC.status) {
                    logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);
                    logit(logger, `[makeTradeDecision] Price is going UP and we HAVE a position -> do nothing`);

                    reject({
                        action: 'none',
                        message: 'Price UP + Have Position -> Do Nothing',
                    });
                }
                // True | False
                // --> if properMove True, we should buy ETH (havePosition False -> make it True)
                    // >> should look at USD and send BUY order to convert to ETH
                    // >> set havePosition to True
                else {
                    logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);
                    logit(logger, `[makeTradeDecision] Price is going UP and we DO NOT HAVE a position -> buy BTC`);

                    resolve({
                        action: 'buy',
                        message: 'Price UP + No Position -> BUY BTC',
                    });

                }
                break;

            case false:
                // >> check for InitialRound -> set to False since price is going down
                if (BTC.initial === true) {
                    logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);
                    logit(logger, `[makeTradeDecision] Flipped Initial Round to false so next uptick is a clean buy`);
                    BTC.initial = false;
                }

                // False | True
                // --> if properMove False, we should sell ETH (havePosition True -> make it False)
                    // >> should look at ETH and send SELL order to convert to USD
                    // >> set havePosition to False
                if (BTC.status) {
                    logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);

                    resolve({
                        action: 'sell',
                        message: 'Price DOWN + Have Position -> SELL ETH',
                    });
                }
                // False | False
                // --> if properMove False, we should hold USD (havePosition False)
                    // >> do nothing
                else {
                    logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);

                    reject({
                        action: 'none',
                        message: 'Price DOWN + No Position -> Do Nothing',
                    });
                }
                break;

            default:
                logit(logger, `[makeTradeDecision] initial ${BTC.initial} | properMove ${BTC_move} | havePosition ${BTC.status}`);
                logit(logger, `[makeTradeDecision] makeTradeDecision was called but situation could not be handled`);

                reject({
                    action: 'error',
                    message: 'No trade decision could be made, check logs',
                });
        }
    });
}

// check action decision and follow through on it
function handleTradeDecision (pDecisionObj) {
    return new Promise((resolve, reject) => {
        logit(logger, `[handleTradeDecision] Entering handleTradeDecision`);
        logit(logger, `[handleTradeDecision] Action: ${pDecisionObj.action}`);
        logit(logger, `[handleTradeDecision] Message: ${pDecisionObj.message}`);

        // if there is nothing for us to do, end processing to not waste time / resources
        if (pDecisionObj.action === 'none' || pDecisionObj === 'error') {
            reject(pDecisionObj.message);
            logit(logger, `[handleTradeDecision] Breaking out of handleTradeDecision since nothing to do`);
            return;
        }

        // grab all relevant data, DRYs the code but is technically a little inefficient
        logit(logger, `[handleTradeDecision] Gathering data from Authed Client`);
        Promise.all([
            authedClient.getProductOrderBook(BTC.ticker),
            authedClient.getAccount(keychain.usdAccount),
            authedClient.getAccount(keychain.btcAccount),
        ])
            .then(results => {
                const orderBook = results[0];
                const usdAccount = results[1];
                const btcAccount = results[2];

                logit(logger, JSON.stringify(orderBook));
                logit(logger, JSON.stringify(usdAccount));
                logit(logger, JSON.stringify(btcAccount));

                switch (pDecisionObj.action) {

                    // Enter into Buy Logic
                    case 'buy':
                        logit(logger, `[handleTradeDecision] Selected Buy case, creating buy order`);
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

                        logit(logger, `[handleTradeDecision] Paid USD @ ${buyTxn.price}/coin and ${buyTxn.fee} fee`);
                        logit(logger, `[handleTradeDecision] Total Transactions: ${BTC.txn.length}`);
                        totalFees += buyFee;

                        // swap status to true since we bought
                        BTC.status = true;
                        logit(logger, `[handleTradeDecision] havePosition is now ${BTC.status}`);
                        resolve(`[handleTradeDecision] Purchase completely processed`);
                        break;

                    // Enter into Sell Logic
                    case 'sell':
                        logit(logger, `[handleTradeDecision] Selected Sell case, creating sell order`);
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

                        logit(logger, `[handleTradeDecision] Sold for USD @ ${sellTxn.price}/coin and ${sellTxn.fee} fee`);
                        logit(logger, `[handleTradeDecision] Total Transactions: ${BTC.txn.length}`);
                        totalFees += sellFee;

                        // swap status to true since we sold
                        BTC.status = false;
                        logit(logger, `[handleTradeDecision] havePosition is now ${BTC.status}`);


                        // Calculate the profit since we sold stuff
                        // use the transactions just to test each out
                        // @TODO this could be cleaner obviously
                        const boughtTxn = BTC.txn.slice(-2)[0];
                        const soldTxn = BTC.txn.slice(-1)[0];
                        const profit = soldTxn.price - soldTxn.fee - boughtTxn.price - boughtTxn.fee;
                        totalProfit += profit;

                        logit(logger, `[handleTradeDecision] TX Profit: ${profit}`);
                        logit(logger, `[handleTradeDecision] Total Profit: ${totalProfit}`);
                        logit(logger, `[handleTradeDecision] Total Fees: ${totalFees}`);
                        resolve(`[handleTradeDecision] Sale completely processed`);
                        break;

                    default:
                        reject(`[handleTradeDecision] No action could be read from DecisionObject`);
                        return;
                }
            })
            .catch(err => {logit(logger, err)});


    });
}

function generatePage() {
    logit(logger, `[generatePage] Entering generatePage`);
    const snapshot = BTC.data.slice(0,12);

    let page = `<h1>CRYPTO BOT</h1>`;
    page += `<p>SHORT_PERIODS = ${SHORT_PERIODS}</p>`;
    page += `<p>LONG_PERIODS = ${LONG_PERIODS}</p>`;
    page += '<br>';

    page += `<p>Have position? ${BTC.status}</p>`;
    page += `<p>Initial round? ${BTC.initial}</p>`;
    page += `<p>Data Length: ${BTC.data.length}</p>`;
    page += `<p>Transactions: ${BTC.txn.length}</p>`;
    page += '<br>';

    page += `<p>Profit (total): ${totalProfit}</p>`;
    page += `<p>Fees (total): ${totalFees}</p>`;
    page += '<br>';

    snapshot.forEach((each) => {
        page += `<p>${JSON.stringify(each)}</p>`;
    });
    page += '<br>';

    BTC.txn.forEach((each) => {
        page += `<p>Time: ${each.timestamp} | Type: ${each.type} | Price: ${each.price}  | Fees: ${each.fee}</p>`;
    });

    return page;
}
