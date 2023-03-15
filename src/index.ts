import puppeteer from "puppeteer";
import * as dotenv from "dotenv";
import { mkDirByPathSync, sleep, writeFileIfNotExistsSync } from "./utils";

dotenv.config();
const SITE_URL = "https://www.digibidi.com";

const downloadBook = async (startingPage: number, bookSlugName: string) => {
  console.log(`downloading book "${bookSlugName}" starting from page "${startingPage}"`);
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // login to the website
  await page.goto(`${SITE_URL}/account/login`);
  await page.type("#id_email", process.env.LOGIN as string);
  await page.type("#id_password", process.env.PASSWORD as string);
  console.log("waiting for login...");
  await Promise.all([
    page.click("div.submit > input[type=submit]"),
    await page.waitForNavigation(),
  ]);
  console.log("logged in");
  await sleep(434);

  // go to the book player
  console.log("opening the player for the book...");
  await page.goto(
    `${SITE_URL}/player/full/${bookSlugName}${startingPage !== 1 ? `#${startingPage}` : ""}`
  );
  // await page.waitForNetworkIdle();
  await sleep(1111);
  console.log("player opened");

  // get the number of pages
  const listOfPageKey = await page.evaluate(() => {
    const options = document.querySelectorAll("select#pages > option");
    //@ts-ignore
    return Array.from(options).map((option) => ({ value: option.value, key: option.dataset.key }));
  });
  // console.log({ listOfPageKey });

  // @ts-ignore
  const PLAYER_KEY = await page.evaluate(() => window.player_key);
  // console.log({ PLAYER_KEY });
  const getPageIdFromKey = (pageKey: string) => {
    const obfuscate1 =
      65536 | (parseInt(PLAYER_KEY.slice(0, 4), 16) ^ parseInt(pageKey.slice(0, 4), 16));
    const obfuscate2 = 65536 | (parseInt(PLAYER_KEY.slice(4), 16) ^ parseInt(pageKey.slice(4), 16));
    return obfuscate1.toString(16).slice(1) + obfuscate2.toString(16).slice(1);
  };

  const pageIdToPageNameHashMap = listOfPageKey.reduce(
    (acc, { key, value }) => ({ ...acc, [getPageIdFromKey(key)]: value }),
    {} as Record<string, string>
  );

  const bookFolderName = `books/${bookSlugName}`;
  // create a folder named after the book slug name
  mkDirByPathSync(bookFolderName);

  // register the response listener to save the images if they are not already saved
  const savedImagesIds = new Set();
  page.on("response", async (response) => {
    const responseUrl = response.url();
    const matches = /.*pages.*\/xlarge\/([a-zA-Z0-9_.-]*)\.(jpg|png|svg|gif)$/.exec(responseUrl);
    console.log({ responseUrl, matches });

    if (matches && matches.length === 3) {
      const pageId = matches[1];
      const extension = matches[2];

      if (savedImagesIds.has(pageId)) {
        return;
      } else {
        savedImagesIds.add(pageId);
      }

      const buffer = await response.buffer();
      const pageName = pageIdToPageNameHashMap[pageId];
      const paddedPageName = pageName === "cover" ? `001-${pageName}` : pageName.padStart(3, "0");
      const pageFileName = `${bookFolderName}/${bookSlugName}-page-${paddedPageName}-${pageId}.${extension}`;
      console.log(`saving page "${pageFileName}"`);
      writeFileIfNotExistsSync(pageFileName, buffer, "base64");
    }
  });

  page.on("framenavigated", (frame) => {
    const url = frame.url(); // the new url
    console.log("navigated to", url);
  });

  // click on the zoom button to get the full resolution.
  // done trhough the eval function because the button is not
  // found through the page.click function
  await page.evaluate(() => {
    // @ts-ignore
    document.querySelector("a#button-zoom-xlarge").click();
  });
  await sleep(1356);

  const numberOfPages = listOfPageKey.length - 1;
  // click on the next page button up to the last page
  for (let i = startingPage + 1; i <= numberOfPages; i += 1) {
    console.log("navigating to page ", i);

    try {
      await Promise.all([
        // for some reason, after 40 to 50 navigations, it seem to not request the images anymore
        page.waitForResponse((response) => {
          const responseUrl = response.url();
          const matches = /.*pages.*\/xlarge\/([a-zA-Z0-9_.-]*)\.(jpg|png|svg|gif)$/.exec(
            responseUrl
          );
          return matches && matches.length === 3;
        }),
        page.goto(`${SITE_URL}/player/full/${bookSlugName}\#${i}`),
      ]);
    } catch (error) {
      const currentPageIsStartingPage = i === startingPage + 1;
      // so if the images are not requested anymore, we re-attempt the process
      if (
        (error?.message as string).toLowerCase().includes("timeout") &&
        !currentPageIsStartingPage
      ) {
        console.log("error while click navigating to page", i);
        console.log("error", error);
        console.log("re-attempting the process starting at the failed page...");
        return downloadBook(i - 1, bookSlugName);
      } else {
        throw error;
      }
    }

    await sleep(1234);
  }

  await browser.close();
  console.log("Done");
  process.exit(0);
};

const STARTING_PAGE = parseInt(process.env.STARTING_PAGE, 10) || 1;
const BOOK_SLUG_NAME = process.env.BOOK_SLUG_NAME as string;
(async () => {
  await downloadBook(STARTING_PAGE, BOOK_SLUG_NAME);
})();
