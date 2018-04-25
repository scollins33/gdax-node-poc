/* ------------------------------------------
        REQUIRED PACKAGES
   ------------------------------------------ */
const { WebsocketClient, AuthenticatedClient } = require('gdax');
const fs = require('fs');
const express = require('express');
const moment = require('moment');


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
else if (SHORT_PERIODS > 1439 || LONG_PERIODS > 1440) {
    console.log(`[HELP] Moving average lengths cannot exceed 1440`);
    process.exit(1);
}

const keychain = JSON.parse(fs.readFileSync('keychain.txt', 'utf8'));


/* ------------------------------------------
        GLOBALS
   ------------------------------------------ */

let BTC_DATA = [];
let ETH_DATA = [];

let BTC_STATUS = false;
let ETH_STATUS = false;

let BTC_INITIAL = true;
let ETH_INITIAL = true;

let HISTORY = [];
let BLOCKID = 1;


/* ------------------------------------------
        START BOT FUNCTIONS
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

// Spawn the WebSocket connection info and start getting data
logit(logger, `[STARTUP] Running bot using ${SHORT_PERIODS} and ${LONG_PERIODS}`);
// startWebsocket();

// Create the Authorized Client
const authedClient = new AuthenticatedClient(
    keychain.key,
    keychain.secret,
    keychain.passphrase,
    'https://api.gdax.com'
);

// Create interval to store data, reset block, and report current status
setInterval(() => {
    // Promise chain to handle logic
    handleBlock()
        .then(() => writeBackup())
        .then(() => calcAverages())
        .then(averages => makeTradeDecision(averages))
        // .then(decision => handleTradeDecision(decision))
        .then(result => console.log(result))
        .catch((err) => logit(logger, `[Promise Chain] ${err}`));
}, 5000);


/* ------------------------------------------
        START EXPRESS SERVER
   ------------------------------------------ */
const app = express();
app.get('/', (req, res) => {
    res.send(generatePage());
});

app.listen(8080, () => logit(logger, '[WEB] App listening on 8080'));


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

        const btc = authedClient.getProductOrderBook("BTC-USD")
            .then(data => {
                return BTC_DATA.unshift({
                    startTime: moment().format('MM/DD/YYYY HH:mm:ss'),
                    sequence: data.sequence,
                    bid: parseFloat(data.bids[0][0]),
                    ask: parseFloat(data.asks[0][0]),
                });
            })
            .catch((err) => logit(logger, `[BTC GET] ${err}`));

        const eth = authedClient.getProductOrderBook("ETH-USD")
            .then(data => {
                return ETH_DATA.unshift({
                    startTime: moment().format('MM/DD/YYYY HH:mm:ss'),
                    sequence: data.sequence,
                    bid: parseFloat(data.bids[0][0]),
                    ask: parseFloat(data.asks[0][0]),
                });
            })
            .catch(err => logit(logger, `[ETH GET] ${err}`));

        Promise.all([btc, eth])
            .then(values => resolve(true))
            .catch(err => logit(logger, `[ALL GET] ${err}`));
    });
}

// Compute and compare moving averages, report on current trend
function calcAverages () {
    return new Promise((resolve, reject) => {
        logit(logger, `[calcAverages] Entering calcAverages`);
        // create the trailing arrays
        const btc_short = BTC_DATA.slice(0,SHORT_PERIODS);
        const btc_long = BTC_DATA.slice(0,LONG_PERIODS);

        const eth_short = ETH_DATA.slice(0,SHORT_PERIODS);
        const eth_long = ETH_DATA.slice(0,LONG_PERIODS);

        // reduce the trailing arrays to the total
        const btc_short_bids = btc_short.reduce((sum, cur) => { return sum + cur.bid; }, 0);
        const btc_long_bids = btc_long.reduce((sum, cur) => { return sum + cur.bid; }, 0);
        const btc_short_asks = btc_short.reduce((sum, cur) => { return sum + cur.ask; }, 0);
        const btc_long_asks = btc_long.reduce((sum, cur) => { return sum + cur.ask; }, 0);

        const eth_short_bids = eth_short.reduce((sum, cur) => { return sum + cur.bid; }, 0);
        const eth_long_bids = eth_long.reduce((sum, cur) => { return sum + cur.bid; }, 0);
        const eth_short_asks = eth_short.reduce((sum, cur) => { return sum + cur.ask; }, 0);
        const eth_long_asks = eth_long.reduce((sum, cur) => { return sum + cur.ask; }, 0);

        // average out the totals
        const btc_short_bids_avg = Math.round(btc_short_bids / SHORT_PERIODS * 100) / 100;
        const btc_long_bids_avg = Math.round(btc_long_bids / LONG_PERIODS * 100) / 100;
        const btc_short_asks_avg = Math.round(btc_short_asks / SHORT_PERIODS * 100) / 100;
        const btc_long_asks_avg = Math.round(btc_long_asks / LONG_PERIODS * 100) / 100;


        const eth_short_bids_avg = Math.round(eth_short_bids / SHORT_PERIODS * 100) / 100;
        const eth_long_bids_avg = Math.round(eth_long_bids / LONG_PERIODS * 100) / 100;
        const eth_short_asks_avg = Math.round(eth_short_asks / SHORT_PERIODS * 100) / 100;
        const eth_long_asks_avg = Math.round(eth_long_asks / LONG_PERIODS * 100) / 100;

        logit(logger, `[calcAverages] BTC Short Bids MA: ${btc_short_bids_avg}`);
        logit(logger, `[calcAverages] BTC Long Bids  MA: ${btc_long_bids_avg}`);
        logit(logger, `[calcAverages] BTC Short Asks MA: ${btc_short_asks_avg}`);
        logit(logger, `[calcAverages] BTC Long Asks  MA: ${btc_long_asks_avg}`);
        logit(logger, `[calcAverages] ETH Short Bids MA: ${eth_short_bids_avg}`);
        logit(logger, `[calcAverages] ETH Long Bids MA: ${eth_long_bids_avg}`);
        logit(logger, `[calcAverages] ETH Short Asks MA: ${eth_short_asks_avg}`);
        logit(logger, `[calcAverages] ETH Long Asks MA: ${eth_long_asks_avg}`);
        logit(logger, '* ------------------------------------------ *');

        if (BTC_DATA.length > LONG_PERIODS && ETH_DATA > LONG_PERIODS) {
            resolve([
                btc_short_bids_avg,
                btc_long_bids_avg,
                btc_short_asks_avg,
                btc_long_asks_avg,
                eth_short_bids_avg,
                eth_long_bids_avg,
                eth_short_asks_avg,
                eth_long_asks_avg,
            ]);
        } else {
            reject('ARCHIVE not long enough');
        }
    });
}

// Take in the last minute MAs and decide what to do
// avgArray format: [short, long]
function makeTradeDecision(avgArray) {
    return new Promise((resolve, reject) => {
        logit(logger, `[makeTradeDecision] Entering makeTradeDecision`);

        let BTC_short = 0;
        let BTC_long = 0;
        let ETH_short = 0;
        let ETH_long = 0;

        if (BTC_STATUS) {
            // asks
            BTC_short = avgArray[2];
            BTC_long = avgArray[3];
        } else {
            // bids
            BTC_short = avgArray[0];
            BTC_long = avgArray[1];
        }

        if (ETH_STATUS) {
            // asks
            ETH_short = avgArray[6];
            ETH_long = avgArray[7];
        } else {
            // bids
            ETH_short = avgArray[4];
            ETH_long = avgArray[5];
        }

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
        const BTC_move = BTC_short > BTC_long;
        const ETH_move = ETH_short > ETH_long;

        // BTC Decision
        switch (BTC_move) {

            case true:
                // >> check for InitialRound -> pass if it is
                if (BTC_INITIAL) {
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
                if (BTC_STATUS) {
                    logit(logger, `[makeTradeDecision] properMove ${BTC_move} | havePosition ${BTC_STATUS}`);
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
                    logit(logger, `[makeTradeDecision] properMove ${BTC_move} | havePosition ${BTC_STATUS}`);
                    logit(logger, `[makeTradeDecision] Price is going UP and we DO NOT HAVE a position -> buy BTC`);

                    resolve({
                        action: 'buy',
                        message: 'Price UP + No Position -> BUY BTC',
                    });

                }
                break;

            case false:
                // >> check for InitialRound -> set to False since price is going down
                if (STATUS.initialRound) {
                    logit(logger, `[makeTradeDecision] Flipped Initial Round to false so next uptick is a clean buy`);
                    STATUS.initialRound = false;
                }

                // False | True
                // --> if properMove False, we should sell ETH (havePosition True -> make it False)
                    // >> should look at ETH and send SELL order to convert to USD
                    // >> set havePosition to False
                if (STATUS.havePosition) {
                    logit(logger, `[makeTradeDecision] properMove ${properMove} | havePosition ${STATUS.havePosition}`);

                    resolve({
                        action: 'sell',
                        message: 'Price DOWN + Have Position -> SELL ETH',
                    });
                }
                // False | False
                // --> if properMove False, we should hold USD (havePosition False)
                    // >> do nothing
                else {
                    logit(logger, `[makeTradeDecision] properMove ${properMove} | havePosition ${STATUS.havePosition}`);

                    reject({
                        action: 'none',
                        message: 'Price DOWN + No Position -> Do Nothing',
                    });
                }
                break;

            default:
                logit(logger, `[makeTradeDecision] properMove ${properMove} | havePosition ${STATUS.havePosition}`);
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
        logit(logger, `[handleTradeDecision] Action is ${pDecisionObj.action}`);

        // if there is nothing for us to do, end processing to not waste time / resources
        if (pDecisionObj.action === 'none' || pDecisionObj === 'error') {
            reject(pDecisionObj.message);
            logit(logger, `[handleTradeDecision] Breaking out of handleTradeDecision since nothing to do`);
            return;
        }

        // grab all relevant data, DRYs the code but is technically a little inefficient
        logit(logger, `[handleTradeDecision] Gathering data from Authed Client`);
        Promise.all([
            authedClient.getProductOrderBook('ETH-USD'),
            authedClient.getAccount(keychain.usdAccount),
            authedClient.getAccount(keychain.ethAccount),
        ])
            .then(results => {
                const orderBook = results[0];
                const usdAccount = results[1];
                const ethAccount = results[2];

                logit(logger, JSON.stringify(orderBook));
                logit(logger, JSON.stringify(usdAccount));
                logit(logger, JSON.stringify(ethAccount));

                switch (pDecisionObj.action) {

                    // Enter into Buy Logic
                    case 'buy':
                        logit(logger, `[handleTradeDecision] Selected Buy case, creating buy order`);
                        const buyParams = {
                            type: 'market',
                            side: 'buy',
                            product_id: 'ETH-USD',
                            funds: (usdAccount.available * 0.98).toFixed(2),
                        };
                        logit(logger, JSON.stringify(buyParams));


                        // @TODO THESE NUMBERS ARE FOR 1 ETH BASICALLY, NOT USING USD ACCOUNT BALANCE
                        logit(logger, `[handleTradeDecision] Ask (Theoretical Buy Price): ${orderBook.asks[0][0]}`);
                        STATUS.lastBuyPrice = orderBook.asks[0][0];
                        STATUS.lastBuyCost = (STATUS.lastBuyPrice * 0.0025).toFixed(2);
                        STATUS.totalFees += Number(STATUS.lastBuyCost);
                        logit(logger, `[handleTradeDecision] Paid USD @ ${STATUS.lastBuyPrice}/ETH and ${STATUS.lastBuyCost} fee`);

                        STATUS.havePosition = true;
                        logit(logger, `[handleTradeDecision] havePosition is now ${STATUS.havePosition}`);
                        break;

                    // Enter into Sell Logic
                    case 'sell':
                        logit(logger, `[handleTradeDecision] Selected Sell case, creating sell order`);
                        const sellParams = {
                            type: 'market',
                            side: 'sell',
                            product_id: 'ETH-USD',
                            size: ethAccount.available,
                        };
                        logit(logger, JSON.stringify(sellParams));


                        // @TODO THESE NUMBERS ARE FOR 1 ETH BASICALLY, NOT USING USD ACCOUNT BALANCE
                        logit(logger, `[handleTradeDecision] Bid (Theoretical Sell Price): ${orderBook.bids[0][0]}`);
                        STATUS.lastSellPrice = orderBook.bids[0][0];
                        STATUS.lastSellCost = (STATUS.lastSellPrice * 0.0025).toFixed(2);
                        STATUS.totalFees += Number(STATUS.lastSellCost);
                        logit(logger, `[handleTradeDecision] Sold for USD @ ${STATUS.lastSellPrice}/ETH and ${STATUS.lastSellCost} fee`);

                        STATUS.havePosition = false;
                        logit(logger, `[handleTradeDecision] havePosition is now ${STATUS.havePosition}`);

                        const profit = STATUS.lastSellPrice - STATUS.lastSellCost - STATUS.lastBuyPrice - STATUS.lastBuyCost;
                        STATUS.totalProfit += profit;

                        logit(logger, `[handleTradeDecision] TX Profit: ${profit} | Total Profit: ${STATUS.totalProfit}`);

                        // Add the full cycle data to the History
                        const fees = STATUS.lastSellCost + STATUS.lastBuyCost;
                        const cycle = {
                            time: moment().format('MM/DD/YYYY HH:mm:ss'),
                            purchase: STATUS.lastBuyPrice,
                            sale: STATUS.lastSellPrice,
                            fees: fees,
                            profit: profit,
                            totalProfit: STATUS.totalProfit,
                        };

                        HISTORY.push(cycle);
                        fs.appendFile('./logs/history.txt', JSON.stringify(cycle) + ',', (err) => { if (err) throw err; });
                        break;

                    default:
                        logit(logger, `[handleTradeDecision] No action could be read from DecisionObject`);
                        return;
                }
            })
            .catch(err => {logit(logger, err)});


    });
}

function generatePage() {
    logit(logger, `[generatePage] Entering generatePage`);
    const snapshot = ARCHIVE.slice(0,5);

    let page = `<h1>CRYPTO BOT</h1>`;
    page += `<p>SHORT_PERIODS = ${SHORT_PERIODS}</p>`;
    page += `<p>LONG_PERIODS = ${LONG_PERIODS}</p>`;
    page += '<br>';

    page += `<p>Profit (total): ${STATUS.totalProfit}</p>`;
    page += `<p>Fees (total): ${STATUS.totalFees}</p>`;
    page += `<p>Last Buy: ${STATUS.lastBuyPrice}</p>`;
    page += `<p>Last Buy Fee: ${STATUS.lastBuyCost}</p>`;
    page += `<p>Last Sell: ${STATUS.lastSellPrice}</p>`;
    page += `<p>Last Sell Fee: ${STATUS.lastSellCost}</p>`;
    page += `<p>Have position? ${STATUS.havePosition}</p>`;
    page += `<p>Initial round? ${STATUS.initialRound}</p>`;
    page += '<br>';

    snapshot.forEach((each) => {
        page += `<p>${JSON.stringify(each)}</p>`;
    });
    page += '<br>';

    HISTORY.forEach((each) => {
        page += `<p>Time: ${each.time} | Bought: ${each.purchase} | Sold: ${each.sale}  | Fees: ${each.fees} | Profit: ${each.profit} | Total: ${each.totalProfit} </p>`;
    });

    return page;
}
