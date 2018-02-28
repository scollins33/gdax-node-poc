// Their GTT module - for multiple exchanges
// written with TypeScript but JS can be used
// const GTT = require('gdax-trading-toolkit');
// const { Core, Exchanges, Factories } = require('gdax-trading-toolkit');

/* GDAX Message
{
    type: 'match',
    trade_id: 28774734,
    maker_order_id: '51771fe1-f811-48a5-a855-5715d3d8026d',
    taker_order_id: '34aaf681-6bfb-4e6b-8f5a-c98b5ce8d7fc',
    side: 'buy',
    size: '0.95000000',
    price: '766.24000000',
    product_id: 'ETH-USD',
    sequence: 2438925935,
    time: '2018-02-08T01:15:16.110000Z'
} */

/* Weighted Average calc
4.5 @ 300 = 1350
2.0 @ 310 = 620
2.0 * 310 + 300 * 4.5 = 1970
1970 / 6.5 = 303.08
*/


/* ------------------------------------------
        REQUIRED PACKAGES
   ------------------------------------------ */

// Their GDAX-only node module
const GDAX = require('gdax');
const { PublicClient, WebsocketClient, AuthenticatedClient } = require('gdax');
const CustomWS = require('./lib/websocket');
const fs = require('fs');


/* ------------------------------------------
        GLOBALS
   ------------------------------------------ */

// create file if needed and start logging stream
if (!fs.existsSync('./logs/test.txt')) {
    fs.closeSync(fs.openSync('./logs/test.txt', 'w'));
}
const logStream = fs.createWriteStream('./logs/test.txt');

// create the archive array and initial block
let archive = [];

let BLOCKID = 1;
let currentBlock = {
    blockID: BLOCKID,
    matches: 0,
    volume: 0.0,
    sumStrike: 0.0,
    weightAvg: 0.0,
    low: null,
    high: null
};

// Spawn the websocket connection info and start getting data
startWS();

/* ------------------------------------------
        CORE FUNCTIONALITY
   ------------------------------------------ */

function startWS () {
    logit(`[DEBUG] Creating Websocket connection and handlers`);
    // use custom Websocket Client to change what channels are being sub'd to
    let wsCustom = new CustomWS(['ETH-USD']);

    wsCustom.on('message', data => {
        if (data.type === 'match') {
            handleInfo(data, currentBlock);
        }
    });
    wsCustom.on('error', err => { logStream.write(err) });
    
    wsCustom.on('close', () => { startWS() });
}

// Create interval to store data, reset block, and report current status
// Interval should run every minute to create 1-minute blocks
setInterval(() => {
    currentBlock = handleBlock(currentBlock);
}, 60000);


/* ------------------------------------------
        HELPER FUNCTIONS
   ------------------------------------------ */

// Helper function to consolelog and writelog
function logit (pMessage) {
    console.log(pMessage);
    logStream.write(pMessage + ' \n');
}

// Parse new data and update current block
function handleInfo (pData, pBlock) {
    const tradePrice = parseFloat(pData.price);
    const tradeSize = parseFloat(pData.size);

    // increment matches and add volume to total
    // calculate the new weighted average of the block
    pBlock.matches++;
    pBlock.volume += tradeSize;
    pBlock.sumStrike += (tradePrice * tradeSize);
    pBlock.weightAvg = pBlock.sumStrike / pBlock.volume;

    // check if this is a new high or low
    // null check to handle new block
    if (pBlock.low === null && pBlock.high === null) {
        pBlock.low = tradePrice;
        pBlock.high = tradePrice;
    }
    else if (tradePrice < pBlock.low) {
        pBlock.low = tradePrice;
    }
    else if (tradePrice > pBlock.high) {
        pBlock.high = tradePrice;
    }
}

// Deal with storage of the block and catch empty/trouble blocks in case of connection loss
function handleBlock (pBlock) {
    BLOCKID++;
    const freshBlock = {
        blockID: BLOCKID,
        matches: 0,
        volume: 0.0,
        sumStrike: 0.0,
        weightAvg: 0.0,
        low: null,
        high: null,
    };
    
    // check for empty block
    // don't need to check for half empty since actions are only taken on Matches and no 0's are written
    if (pBlock.matches === 0) {
        logit('[DEBUG] BLANK BLOCK DETECTED AND IGNORED');
        return freshBlock;
    } else {
        // store the current state of the block into the historical array
        // unshift to add at the start, pop to remove the end
        archive.unshift(pBlock);
        logit(`[DEBUG] ARCHIVE LENGTH: ${archive.length}`);

        if (archive.length > 180) {
            logit(`[DEBUG] archive.length > 180, popping the last stored object`);
    
            archive.pop();
            logit(`[DEBUG] new archive length: ${archive.length}`);
    
        }
        // run ticker since a new block was added and return a fresh block
        runTicker();
        return freshBlock;
    }
}

// Compute and compare moving averages, report on current trend
function runTicker () {
    logit(`[DEBUG] running ticker calculations`);
    // create the trailing arrays
    const trail60 = archive.slice(0,60);
    const trail180 = archive.slice(0,180);
    let debugTally60 = 0;
    let debugTally180 = 0;
    
    // reduce the trailing arrays to the total
    const total60 = trail60.reduce((sum, cur) => {
        debugTally60++;
        return sum + cur.weightAvg;
    }, 0);
    const total180 = trail180.reduce((sum, cur) => {
        debugTally180++;
        return sum + cur.weightAvg;
    }, 0);

    const debugBlocks = archive.slice(0,6);
    debugBlocks.forEach((each) => {
        logStream.write(JSON.parse(each.blockID) + ' \n');
    });

    logit(`[DEBUG] debugTally60 = ${debugTally60}`);
    logit(`[DEBUG] debugTally180 = ${debugTally180}`);
    logit(`[DEBUG] total60 = ${total60}`);
    logit(`[DEBUG] total180 = ${total180}`);

    // average out the totals
    const avg60 = total60 / 60.0;
    const avg180 = total180 / 180.0;

    const status = avg60 > avg180 ? "UP TREND - SHORT OVER LONG" : "DOWN TREND - LONG OVER SHORT";

    logit(`       60 Period Average: ${avg60}`);
    logit(`       180 Period Average: ${avg180}`);
    logit(`       Market Status: ${status}`);
    logit('* ------------------------------------------ *');
}
