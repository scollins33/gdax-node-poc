const moment = require('moment');

class Transaction {
  constructor(pType, pPrice, pFee) {
    this.timestamp = moment();
    this.type = pType;
    this.price = pPrice;
    this.fee = pFee;
  }
}

module.exports = Transaction;
