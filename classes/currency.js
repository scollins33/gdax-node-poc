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
        this.txn.unshift(pPoint);
    }

    addTxn(pTxn) {
        this.txn.push(pTxn);
    }
}

module.exports = Currency;