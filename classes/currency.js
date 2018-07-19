class Currency {
  constructor(pName, pTicker, pAccount, pBackupFile, pHistoryFile) {
    this.name = pName;
    this.ticker = pTicker;
    this.initial = true;
    this.status = false;
    this.account = pAccount;
    this.data = [];
    this.txn = [];
    this.backup = pBackupFile;
    this.history = pHistoryFile;
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
