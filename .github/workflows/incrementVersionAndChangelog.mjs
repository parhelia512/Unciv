import {Octokit} from "@octokit/rest";
import fs from "fs";

// To be run from the root of the Unciv repo (node .github/workflows/incrementVersionAndChangelog.mjs)
// Summarizes and adds the summary to the changelog.md file
// Meant to be run from a Github action as part of the preparation for version rollout

//region Executed Code
(async () => {
    const versionAndChangelog = await parseCommits();
    const newVersionString = versionAndChangelog[0]
    const changelogString = versionAndChangelog[1]

    writeChangelog(newVersionString, changelogString)

    const newAppCodeNumber = updateBuildConfig(newVersionString);
    if (newAppCodeNumber){ // is false if buildConfig already contains the newVersionString
        createFastlaneFile(newAppCodeNumber, changelogString)
        updateGameVersion(newVersionString, newAppCodeNumber);
    }
})();
//endregion


//region Function Definitions

// Returns: [nextVersionString, changelogString]
async function parseCommits() {
    // no need to add auth: token since we're only reading from the commit list, which is public anyway
    const octokit = new Octokit({});

    const result = await octokit.repos.listCommits({
        owner: "yairm210",
        repo: "Unciv",
        per_page: 50
    });

    let commitSummary = "";
    const ownerToCommits = {};
    let reachedPreviousVersion = false;
    let nextVersionString = "";
    result.data.forEach(commit => {
    // See https://github.com/yairm210/Unciv/actions/runs/4136712446/jobs/7151150557 for example of strange commit with null author
            if (reachedPreviousVersion || commit.author == null) return;
            const author = commit.author.login;
            if (author === "uncivbot[bot]") return;
            let commitMessage = commit.commit.message.split("\n")[0];

            const versionMatches = commitMessage.match(/^\d+\.\d+\.(\d+)$/);
            if (versionMatches) { // match EXACT version, like 3.4.55  ^ is for start-of-line, $ for end-of-line
                reachedPreviousVersion = true;
                const minorVersion = Number(versionMatches[1]);
                console.log("Previous version: " + commitMessage);
                nextVersionString = commitMessage.replace(RegExp(minorVersion + "$"), minorVersion + 1);
                console.log("Next version: " + nextVersionString);
                return;
            }
            if (commitMessage.startsWith("Merge ") || commitMessage.startsWith("Update ")) return;
            commitMessage = commitMessage.replace(/\(\#\d+\)/, "").replace(/\#\d+/, ""); // match PR auto-text, like (#2345) or just #2345
            if (author !== "yairm210") {
                if (!(author in ownerToCommits)) ownerToCommits[author] = [];
                ownerToCommits[author].push(commitMessage);
            } else {
                commitSummary += "\n\n" + commitMessage;
            }
        }
    );

    for (const [author, commits] of Object.entries(ownerToCommits)) {
        if (commits.length === 1) {
            commitSummary += "\n\n" + commits[0] + "- By " + author;
        } else {
            commitSummary += "\n\nBy " + author + ":";
            commits.forEach(commitMessage => { commitSummary += "\n- " + commitMessage });
        }
    }
    console.log(commitSummary);
    return [nextVersionString, commitSummary];
}

function writeChangelog(nextVersionString, changelogString){
    const textToAddToChangelog = "## " + nextVersionString + changelogString + "\n\n";

    const changelogPath = 'changelog.md';
    const currentChangelog = fs.readFileSync(changelogPath).toString();
    if (!currentChangelog.startsWith(textToAddToChangelog)) { // minor idempotency - don't add twice
        const newChangelog = textToAddToChangelog + currentChangelog;
        fs.writeFileSync(changelogPath, newChangelog);
    }
}

function updateBuildConfig(nextVersionString) {
    const buildConfigPath = "buildSrc/src/main/kotlin/BuildConfig.kt";
    let buildConfigString = fs.readFileSync(buildConfigPath).toString();

    console.log("Original: " + buildConfigString);

    // Javascript string.match returns a regex string array, where array[0] is the entirety of the captured string,
    //  and array[1] is the first group, array[2] is the second group etc.

    const appVersionMatch = buildConfigString.match(/appVersion = "(.*)"/);
    const curVersion = appVersionMatch[1];
    if (curVersion !== nextVersionString) {
        buildConfigString = buildConfigString.replace(appVersionMatch[0], appVersionMatch[0].replace(curVersion, nextVersionString));
        const appCodeNumberMatch = buildConfigString.match(/appCodeNumber = (\d*)/);
        let currentAppCodeNumber = appCodeNumberMatch[1];
        console.log("Current incremental version: " + currentAppCodeNumber);
        const nextAppCodeNumber = Number(currentAppCodeNumber) + 1;
        console.log("Next incremental version: " + nextAppCodeNumber);
        buildConfigString = buildConfigString.replace(appCodeNumberMatch[0],
            appCodeNumberMatch[0].replace(currentAppCodeNumber, nextAppCodeNumber));

        console.log("Final: " + buildConfigString);
        fs.writeFileSync(buildConfigPath, buildConfigString);
        return nextAppCodeNumber;
    }
    return false
}

function createFastlaneFile(newAppCodeNumber, changelogString){
    // A new, discrete changelog file for fastlane (F-Droid support):
    const fastlaneChangelogPath = "fastlane/metadata/android/en-US/changelogs/" + newAppCodeNumber + ".txt";
    fs.writeFileSync(fastlaneChangelogPath, changelogString);
}

function updateGameVersion(newVersionString, newAppCodeNumber) {
    const gameInfoPath = "core/src/com/unciv/UncivGame.kt";
    const gameInfoSource = fs.readFileSync(gameInfoPath).toString();
    const regexp = /(\/\/region AUTOMATICALLY GENERATED VERSION DATA - DO NOT CHANGE THIS REGION, INCLUDING THIS COMMENT)[\s\S]*(\/\/endregion)/;
    const withNewVersion = gameInfoSource.replace(regexp, function(match, grp1, grp2) {
        const versionClassStr = createVersionClassString(newVersionString, newAppCodeNumber);
        return `${grp1}\n        val VERSION = ${versionClassStr}\n        ${grp2}`;
    })
    fs.writeFileSync(gameInfoPath, withNewVersion);
}

function createVersionClassString(newVersionString, newAppCodeNumber) {
    return `Version("${newVersionString}", ${newAppCodeNumber})`;
}

//endregion
