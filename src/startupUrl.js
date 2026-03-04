import { session } from "electron";
import { isPacked } from "./utils.js";

export async function getStartupURL(isPackaged) {
    const { DEFAULT_URL, LATEST_URL, DEV_URL } = process.env;

    //if packaged: force default/local URL
    if (isPacked) {
        return DEV_URL;
    }

    //if not packaged: check for toggle
    try {
        const cookies = await session.defaultSession.cookies.get({
            name: "useLatestURL",
        });

        const useLatest = cookies?.[0]?.value === "true";

        //if true: use latest URL > else: use dev server
        return useLatest ? LATEST_URL : DEFAULT_URL;
        
    } catch (err) {
        console.error("[getStartUpURL] Cookie read failed", err);
        return DEFAULT_URL;
    }
}