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


/* ------------------------------------------
        GLOBALS
   ------------------------------------------ */

// create PublicClient instance for book checking
// pubClient = new PublicClient();
// use custom Websocket Client to change what channels are being sub'd to
// wsClient = new WebsocketClient(['ETH-USD']);
const wsCustom = new CustomWS(['ETH-USD'])

let MA60 = [];
let MA180 = [];

// create the initial block
let currentBlock = {
    matches: 0,
    volume: 0.0,
    sumStrike: 0.0,
    weightAvg: 0.0,
    low: null,
    high: null
}


/* ------------------------------------------
        CORE FUNCTIONALITY
   ------------------------------------------ */

// Start message feed, handle errors and closing as well
wsCustom.on('message', data => {
    if (data.type === 'match') {
        handleInfo(data, currentBlock);
    }
});
wsCustom.on('error', err => { console.log(err) });
wsCustom.on('close', () => {});

// Create interval to store data, reset block, and report current status
// Interval should run every minute to create 1-minute blocks
const builder = setInterval(() => {
    currentBlock = handleBlock(currentBlock);
    runTicker();
}, 60000);


/* ------------------------------------------
        HELPER FUNCTIONS
   ------------------------------------------ */

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

// Deal with storage of the block
function handleBlock (pBlock) {
    // store the current state of the block into the historical arrays
    MA60.push(pBlock);
    MA180.push(pBlock);
    if (MA60.length > 60) { MA60.shift(); }
    if (MA180.length > 180) { MA180.shift(); }
    
    // return fresh object so currentBlock gets reset
    return {
        matches: 0,
        volume: 0.0,
        sumStrike: 0.0,
        weightAvg: 0.0,
        low: null,
        high: null,
    }
}

// Compute and compare moving averages, report on current trend
function runTicker () {
    const total60 = MA60.reduce((acc, cur) => {
        console.log(acc);
        console.log(cur);
        return acc + cur.weightAvg }, 0);
    const avg60 = total60 / 60.0;

    const total180 = MA180.reduce((acc, cur) => {
        console.log(acc);
        console.log(cur);
        return acc + cur.weightAvg }, 0);
    const avg180 = total180 / 180.0;

    const status = avg60 > avg180 ? "UP TREND - SHORT OVER LONG" : "DOWN TREND - LONG OVER SHORT";

    console.log(`   ----- Debug Lines -----`);
    console.log(`   Total from MA60 reduction: ${total60}`);
    console.log(`   Total from MA180 reduction: ${total180}`);

    console.log('* ------------------------------------------ *')
    console.log(`       60 Period Average: ${avg60}`);
    console.log(`       180 Period Average: ${avg180}`);
    console.log(`       Market Status: ${status}`);
    console.log('* ------------------------------------------ *');
}
