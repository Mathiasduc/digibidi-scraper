import puppeteer from "puppeteer";
import fs from "fs";
import * as dotenv from "dotenv";
import { sleep } from "./utils";

dotenv.config();

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  // await page.setViewport({
  //   width: 3840,
  //   height: 2160,
  //   deviceScaleFactor: 1,
  // });

  // login to the website
  await page.goto("https://www.digibidi.com/account/login");
  await page.type("#id_email", process.env.LOGIN as string);
  await page.type("#id_password", process.env.PASSWORD as string);
  await page.click("div.submit > input[type=submit]");
  await page.waitForNavigation();
  await sleep(434);

  // go to the book player
  await page.goto("https://www.digibidi.com/player/full/rahan-le-mariage-de-rahan");
  await page.waitForNetworkIdle();
  await sleep(811);

  // get the number of pages
  const listOfPageKey = await page.evaluate(() => {
    const options = document.querySelectorAll("select#pages > option");
    //@ts-ignore
    return Array.from(options).map((option) => ({ value: option.value, key: option.dataset.key }));
  });
  console.log({ listOfPageKey });

  //@ts-ignore
  const PLAYER_KEY = await page.evaluate(() => window.player_key);
  console.log({ PLAYER_KEY });
  function getPageIdFromKey(pageKey: string) {
    const obfuscate1 =
      65536 | (parseInt(PLAYER_KEY.slice(0, 4), 16) ^ parseInt(pageKey.slice(0, 4), 16));
    const obfuscate2 = 65536 | (parseInt(PLAYER_KEY.slice(4), 16) ^ parseInt(pageKey.slice(4), 16));
    return obfuscate1.toString(16).slice(1) + obfuscate2.toString(16).slice(1);
  }

  const pageIdToPageNameHashMap = listOfPageKey.reduce(
    (acc, { key, value }) => ({ ...acc, [getPageIdFromKey(key)]: value }),
    {} as Record<string, string>
  );
  console.log({ pageIdToPageNameHashMap });

  // register the response listener to save the images if they are not already saved
  const savedImagesIds = new Set();
  page.on("response", async (response) => {
    const responseUrl = response.url();
    const matches = /.*d\/books\/pages.*\/xlarge\/([a-zA-Z0-9_.-]*)\.(jpg|png|svg|gif)$/.exec(
      responseUrl
    );
    if (matches && matches.length === 3) {
      const pageId = matches[1];
      const extension = matches[2];

      if (savedImagesIds.has(pageId)) {
        return;
      } else {
        savedImagesIds.add(pageId);
      }

      const buffer = await response.buffer();
      fs.writeFileSync(
        `images/image-${pageId}-${pageIdToPageNameHashMap[pageId]}.${extension}`,
        buffer,
        "base64"
      );
    }
  });

  // click on the zoom button to get the full resolution.
  // done trhough the eval function because the button is not
  // found through the page.click function
  await page.evaluate(() => {
    // @ts-ignore
    document.querySelector("a#button-zoom-xlarge").click();
  });
  await page.waitForNetworkIdle();
  await sleep(356);
  await page.screenshot({ path: `images/screenshot.png` });

  const numberOfPages = listOfPageKey.length;
  // click on the next page button up to the last page
  // starting at 1 because the first page is already loaded
  for (let i = 1; i < numberOfPages; i += 1) {
    console.log({ i });

    await page.click("div#contents-wrapper > img");
    await page.waitForNetworkIdle();
    await sleep(256);
    // await page.screenshot({ path: `images/screenshot-${i}.png` });
  }

  await browser.close();
  console.log("Done");
})();
