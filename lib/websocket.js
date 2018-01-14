const { WebsocketClient } = require('gdax');

class customWS extends WebsocketClient {

    constructor(pProductIDs) {
        super(pProductIDs);
    }

    // overriding the onOpen() to customize the channels subscribed to
    // could rewrite the entire class but this is the lazy way
    onOpen() {
        this.emit('open');

        const subscribeMessage = {
            type: 'subscribe',
            product_ids: this.productIDs,
            channels: [
                {
                    "name": "heartbeat",
                    "product_ids": ["ETH-USD"]
                },{
                    "name": "matches",
                    "product_ids": ["ETH-USD"]
                }],
        };

        // Add Signature
        if (this.auth.secret) {
            let sig = signRequest(
                this.auth,
                'GET',
                this.channels ? '/users/self/verify' : '/users/self'
            );
            Object.assign(subscribeMessage, sig);
        }

        this.socket.send(JSON.stringify(subscribeMessage));
    }
}

module.exports = customWS;