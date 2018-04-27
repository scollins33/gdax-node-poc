class Currency {
    constructor(pName, pTicker) {
        this.name = pName;
        this.ticker = pTicker;
        this.initial = true;
        this.status = false;
        this.data = [];
        this.txn = [];
    }

    addData(pPoint) {
        this.data.unshift(pPoint);
    }

    addTxn(pTxn) {
        this.txn.push(pTxn);
    }
}

module.exports = Currency;