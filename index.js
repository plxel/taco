// Require the Bolt package (github.com/slackapi/bolt)
const { App, LogLevel } = require("@slack/bolt");
const url = require("url");
const MongoClient = require("mongodb").MongoClient;

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Create cached connection variable
let cachedDb = null;

//https://potokioworkspace.slack.com/archives/C01D97K4Y2V
//https://potokioworkspace.slack.com/archives/C01878M6E81
// test channel id C01D97K4Y2V
// thanks channel id C01878M6E81

const THANKS_CHANNEL_ID = "C01878M6E81";

const MONGODB_URI = `mongodb+srv://${process.env.MONGODB_URI}?retryWrites=true&w=majority`;

async function logEvent({ client, token, user, text, type }) {
  try {
    await client.chat.postMessage({
      token,
      channel: "C01D97K4Y2V",
      mrkdwn: true,
      text: `[${type}] ${text} | by <@${user}>`
    });
  } catch (e) {
    console.log(e);
  }
}

// A function for connecting to MongoDB,
// taking a single paramater of the connection string
async function connectToDatabase(uri) {
  // If the database connection is cached,
  // use it instead of creating a new connection
  if (cachedDb) {
    return cachedDb;
  }

  // If no connection is cached, create a new one
  const client = await MongoClient.connect(uri, { useNewUrlParser: true });

  // Select the database through the connection,
  // using the database path of the connection string
  const db = await client.db(url.parse(uri).pathname.substr(1));

  // Cache the database connection and return the connection
  cachedDb = db;
  return db;
}

// Fetch conversation history using the ID and a TS from the last example
async function fetchMessage({ channel, ts, token }) {
  let message = "";
  try {
    // Call the conversations.history method using the built-in WebClient
    const result = await app.client.conversations.history({
      // The token you used to initialize your app
      token,
      channel,
      // In a more realistic app, you may store ts data in a db
      latest: ts,
      // Limit results
      inclusive: true,
      limit: 1
    });

    // There should only be one result (stored in the zeroth index)
    message = result.messages[0];
    // Print message text
    console.log(message.text);
  } catch (error) {
    console.error(error);
  }
  return message;
}

async function addTacos(text, authorId) {
  if (!text.includes(":taco:")) {
    return;
  }

  try {
    const db = await connectToDatabase(MONGODB_URI);
    const collection = await db.collection("result");
    const result = (await collection.findOne()) || {};
    const userIds = [
      ...new Set(
        (text.match(/<@(.*?)>/g) || []).map(user => user.replace(/[<>@]/g, ""))
      )
    ];
    if (userIds.length) {
      userIds.forEach(id => {
        if (id !== authorId) {
          result[id] = result[id] ? result[id] + 1 : 1;
        }
      });

      await collection.replaceOne({ _id: result._id }, result);
    }
  } catch (e) {
    console.log(e);
  } finally {
  }
}

// All the room in the world for your code
app.event("app_home_opened", async ({ event, context }) => {
  try {
    const users = await app.client.users.list({ token: context.botToken });

    const db = await connectToDatabase(MONGODB_URI);
    const collection = await db.collection("result");
    const res = (await collection.findOne()) || {};

    const top10 = Object.entries(res)
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => {
        const user = users.members.find(x => x.id === id);
        if (user) {
          return `${user.real_name} ${count}`;
        }
      })
      .filter(Boolean)
      .join("\n");
    /* view.publish is the method that your app uses to push a view to the Home tab */
    const result = await app.client.views.publish({
      /* retrieves your xoxb token from context */
      token: context.botToken,

      /* the user that opened your app's app home */
      user_id: event.user,

      /* the view object that appears in the app home*/
      view: {
        type: "home",
        callback_id: "home_view",

        /* body of the view */
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "*Leaderboard* :tada:"
            }
          },
          {
            type: "divider"
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: top10.length ? top10 : `No tacos yet`
            }
          }
        ]
      }
    });
  } catch (error) {
    console.error(error);
  }
});

app.event("message", async ({ event, client, context }) => {
  if (
    !event.subtype &&
    event.channel === THANKS_CHANNEL_ID &&
    event.text &&
    event.text.includes(":taco:")
  ) {
    await addTacos(event.text, event.user);
    await logEvent({
      client,
      text: event.text,
      type: "message",
      token: context.botToken,
      user: event.user
    });
  }
});

app.message(":wave:", async ({ message, say }) => {
  await say(`Hello, <@${message.user}>`);
});

app.event("reaction_added", async ({ event, context, client }) => {
  // event.item.channel
  if (event.reaction === "taco") {
    if (event.item.channel === THANKS_CHANNEL_ID) {
      const message = await fetchMessage({
        channel: event.item.channel,
        ts: event.item.ts,
        token: context.botToken
      });
      
      if (message) {
        if (message.user === event.user) {
          return;
        }
        await addTacos(message.text, event.user);
        await logEvent({
          client,
          text: message.text,
          type: "reaction",
          token: context.botToken,
          user: event.user
        });
      }
    } else {
      client.chat.postEphemeral({
        token: context.botToken,
        user: event.user,
        channel: event.item.channel,
        mrkdwn: true,
        text:
          "Если хочешь, поблагодари человека в специальном канале <#C01878M6E81>"
      });
    }
  }
});

app.error(error => {
  // Check the details of the error to handle special cases (such as stopping the app or retrying the sending of a message)
  console.error(error);
});

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);

  console.log("⚡️ Bolt app is running!");
})();
