const moment = require('moment');

class Datum {
    /*{
        "sequence": "3",
        "bids": [
            [ price, size, num-orders ],
        ],
        "asks": [
            [ price, size, num-orders ],
        ]
    }*/
    constructor (pData) {
        this.timestamp = moment();
        this.sequence = pData.sequence;
        this.bid = parseFloat(pData.bids[0][0]);
        this.ask = parseFloat(pData.asks[0][0]);
    }
}

module.exports = Datum;