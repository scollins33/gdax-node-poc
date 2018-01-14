// Their GTT module - for multiple exchanges
// written with TypeScript but JS can be used
// const GTT = require('gdax-trading-toolkit');
// const { Core, Exchanges, Factories } = require('gdax-trading-toolkit');

// Their GDAX-only node module
const GDAX = require('gdax');
const { PublicClient, WebsocketClient, AuthenticatedClient } = require('gdax');
const customWS = require('./lib/websocket');

// create PublicClient instance
pubClient = new PublicClient();
// wsClient = new WebsocketClient(['ETH-USD']);
wsCustom = new customWS(['ETH-USD']);

// get the current order book for ETH-USD
// level 3 gives all of them, level 1 only gives the ones at the spread. level 2 seems to be a good median

// pubClient
//     .getProductOrderBook('ETH-USD', {level: 2})
//     .then(data => {
//         console.log(data);
//     })
//     .catch(error => {
//         console.log(error);
//     });

let counter = 0;

wsCustom.on('message', data => {
    if (data.type === 'match') {

        console.log(`----------- ${counter} -----------`);
        console.log(data);

        counter++;
    }
});

wsCustom.on('error', err => { console.log(err) });
wsCustom.on('close', () => {});