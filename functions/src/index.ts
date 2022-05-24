/* eslint-disable max-len */
import * as functions from "firebase-functions";
import puppeteer from "puppeteer";
import {Configuration, OpenAIApi} from "openai";
import {AlpacaClient} from "@master-chief/alpaca";

const NOTIONAL_PERCENT = 0.9;

const openai = new OpenAIApi(new Configuration({
  organization: process.env.OPENAI_ORGANIZATION,
  apiKey: process.env.OPENAI_APIKEY,
}));

const alpaca = new AlpacaClient({
  credentials: {
    key: process.env.ALPACA_KEYID || "",
    secret: process.env.ALPACA_SECRETKEY || "",
    paper: true,
  },
});

const getCramersBrainDumpViaTwitter = async () => {
  const browser = await puppeteer.launch();
  const page = (await browser.pages())[0];
  await page.goto("https://www.twitter.com/jimcramer", {
    waitUntil: "networkidle2",
  });
  await page.waitForTimeout(3000);
  const tweets = await page.evaluate(async () => {
    return document.body.innerText;
  });
  await browser.close();
  return tweets;
};

const aiGetThoseSweetSweetStonks = async (tweets: string) => {
  const gptCompletion = await openai.createCompletion("text-davinci-002", {
    prompt: `${tweets} Jim Cramer recommends selling the following stock tickers: `,
    temperature: 0.7,
    max_tokens: 32,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
  const stonks = gptCompletion?.data?.choices?.[0].text?.match(/\b[A-Z]+\b/g);
  console.info(`Here are the stonk picks. Stonks: ${stonks}`);
  return stonks?.filter((stonk) => stonk !== "CRM") || [];
};

const executeTrade = async (stonks: string[], buyingPower: number) => {
  await alpaca.cancelOrders();
  await alpaca.closePositions({cancel_orders: true});

  const random = Math.floor(Math.random() * stonks.length);

  if (!stonks.length) {
    console.info("No stonks today boys.");
    return null;
  }

  const order = await alpaca.placeOrder({
    symbol: stonks[random],
    notional: buyingPower * NOTIONAL_PERCENT,
    side: "buy",
    type: "market",
    time_in_force: "day",
  });

  console.info(`Gettin' those tendies!!!! Hot damn! We bought ${order?.qty} shares of ${order?.symbol} for ${order?.filled_avg_price}.`);

  return null;
};

export const getThoseTendies = functions
    .runWith({memory: "4GB", secrets: ["ALPACA_KEYID", "ALPACA_SECRETKEY", "OPENAI_ORGANIZATION", "OPENAI_APIKEY"]})
    .pubsub
    .schedule("40 9 * * 1-5")
    .timeZone("America/New_York")
    .onRun(async () => {
      try {
        const account = await alpaca.getAccount();
        if (account?.daytrade_count > 2) {
          console.info(`Sitting this one out. Daytrade count is currently pretty high. ${account.daytrade_count}`);
          return null;
        }
        const tweets: string = await getCramersBrainDumpViaTwitter();
        const stonks = await aiGetThoseSweetSweetStonks(tweets);
        await executeTrade(stonks, account?.buying_power);
      } catch (err) {
        console.error(`Problem getting those tendies, Morty.  Issue: ${err}`);
      }
      return null;
    });

// close all positions from the previous trading day at market open.
export const closeAllTrades = functions
    .runWith({secrets: ["ALPACA_KEYID", "ALPACA_SECRETKEY"]})
    .pubsub
    .schedule("30 9 * * 1-5")
    .timeZone("America/New_York")
    .onRun(async () => {
      try {
        await alpaca.closePositions({cancel_orders: true});
        console.info("Orders canceled. Positions closed.  Check your tendies now Boss.");
      } catch (err) {
        console.error(`ugh oh. we hit a snag closing all the trades out. error: ${err}`);
      }
      return null;
    });
