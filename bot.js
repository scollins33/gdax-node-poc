// Their GTT module - for multiple exchanges
// written with TypeScript but JS can be used
// const GTT = require('gdax-trading-toolkit');
// const { Core, Exchanges, Factories } = require('gdax-trading-toolkit');

// Their GDAX-only node module
const GDAX = require('gdax');
const { PublicClient, WebsocketClient, AuthenticatedClient } = require('gdax');

// create PublicClient instance
pubClient = new PublicClient();
wsClient = new WebsocketClient(['BTC-USD', 'ETH-USD']);

// get the current order book for ETH-USD
// level 3 gives all of them, level 1 only gives the ones at the spread. level 2 seems to be a good median
pubClient
    .getProductOrderBook('ETH-USD', {level: 2})
    .then(data => {
        console.log(data);
    })
    .catch(error => {
        console.log(error);
    });

