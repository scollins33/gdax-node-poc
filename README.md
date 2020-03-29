# gdax-node-poc

Bot meant to be run on a RaspberryPi with simple trading strategies. Connects to GDAX (Coinbase's exhange). 
  
After a lot of trial and error it seems to lose money slowly and make things up with large positve events.    
Suprise surprise - less than 1000 lines of code from a Junior Engineer can't print money. It was a good thought exercise though.  
Learned some pitfalls of deploying on a headless device as well as practiced a bit of OOP in JavaScript.

### Modes

```Moving```
- Calculates the moving average over time and tries to trade right after the short/long averages converge. 
- This is based on MACD trading.

```Percent```
- Tries to "time" the market on a dip and purchase based on changing slope (derivative if you remember Calculus)
- Then just sits and waits until the price rises by X percent in order to trigger a sale.
- This mode isn't operational yet. 
