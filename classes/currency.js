class Currency {
    constructor(pName, pTicker, pAccount) {
        this.name = pName;
        this.ticker = pTicker;
        this.initial = true;
        this.status = false;
        this.account = pAccount;
        this.data = [];
        this.txn = [];
    }

    addData(pPoint) {
        this.data.unshift(pPoint);
    }

    removeData() {
        this.data.pop();
    }

    addTxn(pTxn) {
        this.txn.push(pTxn);
    }
}

module.exports = Currency;