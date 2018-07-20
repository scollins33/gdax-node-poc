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
if (process.argv.length !== 5) {
  console.log('[HELP] Proper usage:  node bot.js [mode] [polling_rate] [short_period] [long_period]');
  process.exit(1);
}

const MODE = process.argv[2];
const POLLING = parseInt(process.argv[3], 10);
const SHORT_PERIODS = parseInt(process.argv[4], 10);
const LONG_PERIODS = parseInt(process.argv[5], 10);

if (Number.isNaN(POLLING) || Number.isNaN(SHORT_PERIODS) || Number.isNaN(LONG_PERIODS)) {
  console.log('[HELP] Proper usage:  node bot.js [polling_rate] [short_period] [long_period]');
  process.exit(1);
} else if (POLLING < 5000) {
  console.log('[HELP] Polling Rate cannot be les than 5000 milliseconds');
  process.exit(1);
} else if (SHORT_PERIODS >= LONG_PERIODS) {
  console.log('[HELP] Short Periods must be less than Long Periods');
  process.exit(1);
} else if (LONG_PERIODS > 4320) {
  console.log('[HELP] Backup is hard-coded for 4320 points, Long Periods cannot exceed it');
  process.exit(1);
} else if (MODE !== 'bob' || MODE !== 'moving') {
  console.log('[HELP] mode needs to be [ bob ] or [ moving ]');
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
  'https://api.gdax.com',
);

// Create the currencies
const BTC = new Currency('Bitcoin', 'BTC-USD', keychain.btcAccount, './logs/btcBackup.json', './logs/btcHistory.json');
const ETH = new Currency('Ethereum', 'ETH-USD', keychain.ethAccount, './logs/ethBackup.json', './logs/ethHistory.json');

let totalProfit = 0;
let totalFees = 0;


/* ------------------------------------------
    BOT START UP CHECKS
  ------------------------------------------ */
// Check for backup and logs folders, then create them if missing
if (!fs.existsSync('./backup')) { fs.mkdirSync('./backup'); }
if (!fs.existsSync('./logs')) { fs.mkdirSync('./logs'); }

// create logs file if needed and open logging stream
if (!fs.existsSync('./logs/debug.txt')) { fs.writeFileSync('./logs/debug.txt', ''); }
const logger = fs.createWriteStream('./logs/debug.txt');

// Check for JSON storage and create it if not
// backup = short term to load in and graph
// history = long term for studies
if (!fs.existsSync('./logs/btcBackup.json')) { fs.writeFileSync('./logs/btcBackup.json', '[]'); }
if (!fs.existsSync('./logs/btcHistory.json')) { fs.writeFileSync('./logs/btcHistory.json', ''); }
if (!fs.existsSync('./logs/ethBackup.json')) { fs.writeFileSync('./logs/ethBackup.json', '[]'); }
if (!fs.existsSync('./logs/ethHistory.json')) { fs.writeFileSync('./logs/ethHistory.json', ''); }


/* ------------------------------------------
    HELPER FUNCTIONS
  ------------------------------------------ */

// Helper function to consolelog and writelog
function logit(pStream, pMessage) {
  console.log(`${moment().format('MM/DD/YYYY HH:mm:ss SSS')} | ${pMessage}`);
  pStream.write(`${moment().format('MM/DD/YYYY HH:mm:ss SSS')} | ${pMessage} \n`);
}

// Deal with storage of the block and catch empty/trouble blocks in case of connection loss
// @TODO need to handle case of empty/failed fetch
function pullData(pCurrency) {
  return new Promise((resolve, reject) => {
    logit(logger, `[pullData | ${pCurrency.ticker}] Entering pullData`);
    authedClient.getProductOrderBook(pCurrency.ticker)
      .then((data) => {
        const point = new Datum(data);

        // add the point to the currency array
        pCurrency.addData(point);
        // remove the oldest point since we don't need to be longer than desired
        if (pCurrency.data.length >= LONG_PERIODS) { pCurrency.removeData(); }

        resolve(point);
      })
      .catch((err) => {
        logit(logger, `[${pCurrency.ticker} GET] ${err}`);
        reject(err);
      });
  });
}

// Helper to write backup of archive
function writeBackup(pCurrency, pData) {
  return new Promise((resolve, reject) => {
    logit(logger, `[writeBackup | ${pCurrency.ticker}] Entering writeBackup`);

    // read in backup then write new backup
    // 4320 = 3 days of data @ 1 minute polling
    fs.readFile(pCurrency.backup, 'utf-8', (err, data) => {
      if (err) { reject(new Error(`backup | ${err}`)); }

      const backup = JSON.parse(data);
      backup.unshift(pData);
      if (backup.length >= 4320) { backup.pop(); }

      fs.writeFile(pCurrency.backup, JSON.stringify(backup), (writeErr) => {
        if (writeErr) { reject(writeErr); }
      });
    });

    // open the history file and append data (non-array)
    fs.appendFile(pCurrency.history, `${JSON.stringify(pData)},`, (err) => {
      if (err) { reject(err); }
    });

    resolve(true);
  });
}

// Compute and compare moving averages, report on current trend
// since Datum stores both the bid and ask we can calc on the fly
function calcAverages(pCurrency) {
  return new Promise((resolve, reject) => {
    const name = pCurrency.ticker;
    logit(logger, `[calcAverages | ${name}] Entering calcAverages`);

    // create the trailing arrays
    const coinShort = pCurrency.data.slice(0, SHORT_PERIODS);
    const coinLong = pCurrency.data.slice(0, LONG_PERIODS);

    let coinShortTotal = null;
    let coinLongTotal = null;
    let coinShortAvg = null;
    let coinLongAvg = null;

    if (pCurrency.status) {
      // if we have a position look at the asks
      logit(logger, `[calcAverages | ${name}] .status = true >> looking at ASKS`);
      coinShortTotal = coinShort.reduce((sum, cur) => sum + cur.ask, 0);
      coinLongTotal = coinLong.reduce((sum, cur) => sum + cur.ask, 0);
      coinShortAvg = Math.round(coinShortTotal / SHORT_PERIODS * 100) / 100;
      coinLongAvg = Math.round(coinLongTotal / LONG_PERIODS * 100) / 100;
    } else {
      // if we do not, look at the bids
      logit(logger, `[calcAverages | ${name}] .status = false >> looking at BIDS`);
      coinShortTotal = coinShort.reduce((sum, cur) => sum + cur.bid, 0);
      coinLongTotal = coinLong.reduce((sum, cur) => sum + cur.bid, 0);
      coinShortAvg = Math.round(coinShortTotal / SHORT_PERIODS * 100) / 100;
      coinLongAvg = Math.round(coinLongTotal / LONG_PERIODS * 100) / 100;
    }

    logit(logger, `[calcAverages | ${name}] Short Total MA: ${coinShortTotal}`);
    logit(logger, `[calcAverages | ${name}] Long Total  MA: ${coinLongTotal}`);
    logit(logger, `[calcAverages | ${name}] Short Avg MA: ${coinShortAvg}`);
    logit(logger, `[calcAverages | ${name}] Long Avg  MA: ${coinLongAvg}`);

    if (pCurrency.data.length >= LONG_PERIODS) {
      resolve([
        coinShortAvg,
        coinLongAvg,
      ]);
    } else {
      logit(logger, `[calcAverages | ${name}] initial ${pCurrency.initial} | havePosition ${pCurrency.status}`);
      reject(new Error('Data History not long enough'));
    }
  });
}

// Take in the last minute MAs and decide what to do
// avgArray format: [short, long]
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
    True | False -> buy
    False | True -> sell
    False | False -> nothing
*/
function decideAction(pCurrency, avgArray) {
  return new Promise((resolve, reject) => {
    const name = pCurrency.ticker;
    logit(logger, `[decideAction | ${name}] Entering decideAction}`);

    // create move set
    const properMove = avgArray[0] > avgArray[1];

    // Log the current status before the switch cases
    const statusString = `[decideAction | ${name}]`
    + `initial ${pCurrency.initial} | `
    + `properMove ${properMove} | `
    + `havePosition ${pCurrency.status}`;
    logit(logger, statusString);

    switch (properMove) {
      case true:
        if (pCurrency.initial === true) {
          logit(logger, `[decideAction | ${name}] Ignored uptick since it's the initial round`);
          reject({ action: 'none', message: 'Initial Round' });
          break;
        }

        if (pCurrency.status) {
          logit(logger, `[decideAction | ${name}] Price is going UP and we HAVE a position -> do nothing`);
          reject({ action: 'none', message: 'Price UP + Have Position -> Do Nothing' });
        } else {
          logit(logger, `[decideAction | ${name}] Price is going UP and we DO NOT HAVE a position -> BUY`);
          resolve({ action: 'buy', message: `Price UP + No Position -> BUY ${name}` });
        }
        break;

      case false:
        if (pCurrency.initial === true) {
          logit(logger, `[decideAction | ${name}] Flipped Initial Round to false so next uptick is a clean buy`);
          pCurrency.initial = false;
        }

        if (pCurrency.status) {
          logit(logger, `[decideAction | ${name}] Price is going DOWN and we HAVE a position -> SELL`);
          resolve({ action: 'sell', message: `Price DOWN + Have Position -> SELL ${name}` });
        } else {
          logit(logger, `[decideAction | ${name}] Price is going DOWN and we DO NOT HAVE a position -> do nothing`);
          reject({ action: 'none', message: 'Price DOWN + No Position -> Do Nothing' });
        }
        break;

      default:
        logit(logger, `[decideAction | ${name}] decideAction was called but situation could not be handled`);
        reject({ action: 'error', message: 'No trade decision could be made, check logs' });
        break;
    }
  });
}

// check action decision and follow through on it
function handleAction(pCurrency, pDecision) {
  return new Promise((resolve, reject) => {
    const name = pCurrency.ticker;
    logit(logger, `[handleAction | ${name}] Entering handleAction`);
    logit(logger, `[handleAction | ${name}] Action: ${pDecision.action}`);
    logit(logger, `[handleAction | ${name}] Message: ${pDecision.message}`);

    if (pDecision.action === 'none' || pDecision === 'error') {
      reject(pDecision.message);
      logit(logger, `[handleAction | ${name}] Breaking out of handleAction - nothing to do`);
    } else {
      // grab all relevant data, DRYs the code but is technically a little inefficient
      logit(logger, `[handleAction | ${name}] Gathering data from Authed Client`);
      Promise.all([
        authedClient.getProductOrderBook(pCurrency.ticker),
        authedClient.getAccount(keychain.usdAccount),
        authedClient.getAccount(pCurrency.account),
      ])
        .then((results) => {
          const orderBook = results[0];
          const usdAccount = results[1];
          const coinAccount = results[2];

          switch (pDecision.action) {
            // Enter into Buy Logic
            // @TODO - using 49% of available funds so both currencies are fundable
            case 'buy': {
              logit(logger, `[handleAction | ${name}] Selected Buy case, creating buy order`);
              const buyParams = {
                type: 'market',
                side: 'buy',
                product_id: pCurrency.ticker,
                funds: Math.round((usdAccount.available * 0.49) * 100) / 100,
              };
              logit(logger, JSON.stringify(buyParams));

              // @TODO THESE NUMBERS ARE FOR 1 COIN BASICALLY, NOT USING USD ACCOUNT BALANCE
              const buyPrice = Math.round(orderBook.asks[0][0] * 100) / 100;
              const buyFee = Math.round((buyPrice * 0.003) * 100) / 100;
              const buyTxn = new Transaction('buy', buyPrice, buyFee);
              pCurrency.addTxn(buyTxn);

              logit(logger, `[handleAction | ${name}] Paid USD @ ${buyTxn.price}/coin and ${buyTxn.fee} fee`);
              logit(logger, `[handleAction | ${name}] Total Transactions: ${pCurrency.txn.length}`);
              totalFees += buyFee;

              // swap status to true since we bought
              pCurrency.status = true;
              logit(logger, `[handleAction | ${name}] havePosition is now ${pCurrency.status}`);
              resolve(`[handleAction | ${name}] Purchase completely processed`);
              break;
            }
            // Enter into Sell Logic
            case 'sell': {
              logit(logger, `[handleAction | ${name}] Selected Sell case, creating sell order`);
              const sellParams = {
                type: 'market',
                side: 'sell',
                product_id: pCurrency.ticker,
                size: coinAccount.available,
              };
              logit(logger, JSON.stringify(sellParams));

              // @TODO THESE NUMBERS ARE FOR 1 COIN BASICALLY, NOT USING USD ACCOUNT BALANCE
              const sellPrice = Math.round(orderBook.bids[0][0] * 100) / 100;
              const sellFee = Math.round((sellPrice * 0.003) * 100) / 100;
              const sellTxn = new Transaction('sell', sellPrice, sellFee);
              pCurrency.addTxn(sellTxn);

              logit(logger, `[handleAction | ${name}] Sold for USD @ ${sellTxn.price}/coin and ${sellTxn.fee} fee`);
              logit(logger, `[handleAction | ${name}] Total Transactions: ${pCurrency.txn.length}`);
              totalFees += sellFee;

              // swap status to true since we sold
              pCurrency.status = false;
              logit(logger, `[handleAction | ${name}] havePosition is now ${pCurrency.status}`);

              // Calculate the profit since we sold stuff
              // use the transactions just to test each out
              // @TODO this could be cleaner obviously
              const boughtTxn = pCurrency.txn.slice(-2)[0];
              const soldTxn = pCurrency.txn.slice(-1)[0];
              const profit = soldTxn.price - soldTxn.fee - boughtTxn.price - boughtTxn.fee;
              totalProfit += profit;

              logit(logger, `[handleAction | ${name}] TX Profit: ${profit}`);
              logit(logger, `[handleAction | ${name}] Total Profit: ${totalProfit}`);
              logit(logger, `[handleAction | ${name}] Total Fees: ${totalFees}`);
              resolve(`[handleAction | ${name}] Sale completely processed`);
              break;
            }

            default: {
              reject(new Error(`[handleAction | ${name}] No action could be read from DecisionObject`));
              break;
            }
          }
        })
        .catch((err) => {
          logit(logger, err);
        });
    }
  });
}

function generatePage() {
  logit(logger, '[generatePage] Entering generatePage');
  const btcSnapshot = BTC.data.slice(0, 10);
  const btcTransacts = BTC.txn.slice(0, 10);
  const ethSnapshot = ETH.data.slice(0, 10);
  const ethTransacts = ETH.txn.slice(0, 10);

  // consolidate profit for individual coin
  // if its a buy you (-) if its a sell you (+)
  const btcProfit = BTC.txn.reduce((sum, each) => {
    if (each.type === 'buy') { return sum - each.price - each.fee; }
    return sum + each.price - each.fee;
  }, 0);

  const ethProfit = ETH.txn.reduce((sum, each) => {
    if (each.type === 'buy') { return sum - each.price - each.fee; }
    return sum + each.price - each.fee;
  }, 0);

  let page = '<h1>CRYPTO BOT</h1>';
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
  page += `<p>BTC Profit: ${btcProfit}</p>`;
  page += '<br>';

  btcSnapshot.forEach((each) => {
    page += `<p>Time: ${each.timestamp} | Sequence: ${each.sequence} | Bid: ${each.bid}  | Ask: ${each.ask}</p>`;
  });
  page += '<br>';

  btcTransacts.forEach((each) => {
    page += `<p>Time: ${each.timestamp} | Type: ${each.type} | Price: ${each.price}  | Fees: ${each.fee}</p>`;
  });
  page += '<br>';

  page += '<h1>ETH Performance</h1>';
  page += `<p>Have position? ${ETH.status}</p>`;
  page += `<p>Initial round? ${ETH.initial}</p>`;
  page += `<p>Data Length: ${ETH.data.length}</p>`;
  page += `<p>Transactions: ${ETH.txn.length}</p>`;
  page += `<p>ETH Profit: ${ethProfit}</p>`;
  page += '<br>';

  ethSnapshot.forEach((each) => {
    page += `<p>Time: ${each.timestamp} | Sequence: ${each.sequence} | Bid: ${each.bid}  | Ask: ${each.ask}</p>`;
  });
  page += '<br>';

  ethTransacts.forEach((each) => {
    page += `<p>Time: ${each.timestamp} | Type: ${each.type} | Price: ${each.price}  | Fees: ${each.fee}</p>`;
  });

  return page;
}

function choosePath(pCurrency) {
  if (pCurrency.status) {
    // we should check if we need to sell
  }
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

app.listen(9033, () => logit(logger, '[WEB] App listening on 9033'));


/* ------------------------------------------
                BOT CORE LOGIC
    ------------------------------------------ */
// Log that we're starting
// Used to generate the Websocket connection here
// Now we're just pull the data every interval
logit(logger, `[STARTUP] Running bot using ${SHORT_PERIODS} and ${LONG_PERIODS}`);

// Create interval to pull and store data, reset block, and report current status
// run once for each currency we want to trade
// Interval is set to the global POLLING

function startMovingBTC() {
  return setInterval(() => {
    // Promise chain to handle logic
    pullData(BTC)
      .then(data => writeBackup(BTC, data))
      .then(() => calcAverages(BTC))
      .then(averages => decideAction(BTC, averages))
      .then(decision => handleAction(BTC, decision))
      .then((result) => {
        logit(logger, result);
        logit(logger, '* ------------------------------------------ *');
      })
      .catch((err) => {
        if (err.action) {
          logit(logger, `[Promise Chain | ${BTC.ticker}] Error.action: ${err.action}`);
          logit(logger, `[Promise Chain | ${BTC.ticker}] Error.message: ${err.message}`);
          logit(logger, '* ------------------------------------------ *');
        } else {
          logit(logger, `[Promise Chain | ${BTC.ticker}] Error: ${err}`);
          logit(logger, '* ------------------------------------------ *');
        }
      });
  }, POLLING);
}

function startMovingETH() {
  return setInterval(() => {
    // Promise chain to handle logic
    pullData(ETH)
      .then(data => writeBackup(ETH, data))
      .then(() => calcAverages(ETH))
      .then(averages => decideAction(ETH, averages))
      .then(decision => handleAction(ETH, decision))
      .then((result) => {
        logit(logger, result);
        logit(logger, '* ------------------------------------------ *');
      })
      .catch((err) => {
        if (err.action) {
          logit(logger, `[Promise Chain | ${ETH.ticker}] Error.action: ${err.action}`);
          logit(logger, `[Promise Chain | ${ETH.ticker}] Error.message: ${err.message}`);
          logit(logger, '* ------------------------------------------ *');
        } else {
          logit(logger, `[Promise Chain | ${ETH.ticker}] Error: ${err}`);
          logit(logger, '* ------------------------------------------ *');
        }
      });
  }, POLLING);
}

function startBobBTC() {
  return setInterval(() => {
    // Promise chain to handle logic
    pullData(BTC)
      .then(data => writeBackup(BTC, data))
      .then(() => choosePath(BTC))
      // .then((result) => {
      //   logit(logger, result);
      //   logit(logger, '* ------------------------------------------ *');
      // })
      .catch((err) => {
        if (err.action) {
          logit(logger, `[Promise Chain | ${BTC.ticker}] Error.action: ${err.action}`);
          logit(logger, `[Promise Chain | ${BTC.ticker}] Error.message: ${err.message}`);
          logit(logger, '* ------------------------------------------ *');
        } else {
          logit(logger, `[Promise Chain | ${BTC.ticker}] Error: ${err}`);
          logit(logger, '* ------------------------------------------ *');
        }
      });
  }, POLLING);
}

function startBobETH() {
  return setInterval(() => {
    // Promise chain to handle logic
    pullData(ETH)
      .then(data => writeBackup(ETH, data))
      .then(() => choosePath(ETH))
      // .then((result) => {
      //   logit(logger, result);
      //   logit(logger, '* ------------------------------------------ *');
      // })
      .catch((err) => {
        if (err.action) {
          logit(logger, `[Promise Chain | ${ETH.ticker}] Error.action: ${err.action}`);
          logit(logger, `[Promise Chain | ${ETH.ticker}] Error.message: ${err.message}`);
          logit(logger, '* ------------------------------------------ *');
        } else {
          logit(logger, `[Promise Chain | ${ETH.ticker}] Error: ${err}`);
          logit(logger, '* ------------------------------------------ *');
        }
      });
  }, POLLING);
}

if (MODE === 'moving') {
  startMovingBTC();
  startMovingETH();
} else if (MODE === 'bob') {
  startBobBTC();
  startBobETH();
} else {
  console.log('[ERROR] NO VIABLE MODE SELECTED, CLOSING THE BOT');
  process.exit(1);
}
