const POSSIBLE_PERKS = {
  "DYNAMAX_PEOPLE_ID": "Dynamax",
  "BOUNTY_PERSON_ID": "Bounty",
  "PLOT_ARMOR_PERSON_ID": "Plot Armor",
  "SWIPER_PEOPLE_ID": "Swiper",
  "VERMIN_WHISPERER_PERSON_ID": "Vermin Whisperer",
};

// TESTING reasons, locks to only pokemon-dev channel and additional dev server
//const ALLOWED_CHANNELS=["1065064038427541594", "1053540259717189714"]

const ALLOWED_CHANNELS = ["1065064038427541594", "1065049126871515176", "1053540259717189714", "1338893857227804797", "1549612233753894964"];

const { stat } = require('fs');
// imports all the util functions we need
const {
  express,
  app,
  fs,
  cron,
  openai,
  discord,
  client,
  cmd,
  askAI,
  adjustPoints,
  setRarity,
  increaseRarity,
  sendLongMessage,
  setupDefaultsIfNecessary,
  checkOffLimits,
  load,
  save,
  awardPointsAndSendMessage,
  handleSpecialPerks,
  isCatchAllowed,
  perkUpdate,
} = require('./util');

// imports all the long typed messages
const written_messages = require('./written-messages')

var saveData;
global.saveData = load(saveData);

app.get('/', (req, res) => {
  res.send("hello world!")
})

app.listen(3000, () => { console.log("Ready!") })

client.on('ready', () => {
  console.log("Bot is ready");
})

// schedules the daily pokemon rarity updates
cron.schedule('00 00 * * *', increaseRarity, { timezone: "America/New_York" });

// schedules the weekly summary and perk updates
cron.schedule('0 12 * * 0', perkUpdate, { timezone: "America/New_York" });


client.on('messageCreate', async msg => {

  // ignore self messages and other bot messages. Restrict messages to only the allowed channels
  if (msg.author === client.user || msg.author.bot || !ALLOWED_CHANNELS.includes("" + msg.channel.id)) {
    return;
  }

  // critical, its janky yeah but pls don't remove it breaks stuff
  if (msg.content.startsWith('!')) {
    saveData = load(saveData);
  }

  if (cmd(msg, 'help-pokemon')) {
    sendLongMessage(msg.channel, written_messages.HELP_POKEMON);
  }

  else if (cmd(msg, 'help-commands')) {
    sendLongMessage(msg.channel, written_messages.HELP_COMMANDS);
  }

  else if (cmd(msg, 'help-perks')) {
    sendLongMessage(msg.channel, written_messages.HELP_PERKS);
  }

  else if (cmd(msg, 'help-admin')) {
    sendLongMessage(msg.channel, written_messages.HELP_ADMIN);
  }

  else if (cmd(msg, 'set-personality')) {
    personality = msg.content.substring(16);

    if (personality.length < 1) {
      msg.channel.send("Please provide a personality");
      return;
    }

    // Check if the personality length exceeds the maximum limit
    if (personality.length > Number(process.env.MAX_PERSONALITY_LENGTH)) {
      msg.channel.send(`The personality description is too long. Please limit it to ${process.env.MAX_PERSONALITY_LENGTH} characters.`);
      return;
    }

    prev_personality = saveData[msg.author.id]["AIPersonality"];
    saveData[msg.author.id]["AIPersonality"] = personality;

    msg.channel.send("Changed personality from **" + prev_personality + "** to **" + personality + "**");

    save(saveData);
  }

  else if (cmd(msg, 'register')) {
    if (setupDefaultsIfNecessary(saveData, msg.author.id, msg.author.username)) {
      msg.channel.send("Successfully registered :thumbsup:");
    } else {
      msg.channel.send("You are already registered :thumbsup:");
    }
  }

  else if (msg.content.toLowerCase().includes('!status')) {

    var statusPerson = msg.mentions.users.first()

    if (!statusPerson) {
      statusPerson = msg.author;
    }
    else {
      if (checkOffLimits(msg)) {
        return;
      }
    }

    try {

      // Get the status person's data for ez access
      userData = saveData[statusPerson.id];

      if (!userData) {
        msg.channel.send("@" + statusPerson.username + " has no available data");
      } else {

        let pokedex = "{\n";
        for (let pokemon of Object.keys(saveData[statusPerson.id]["pokedex"])) {
          pokedex += "\t" + pokemon + ": " + userData["pokedex"][pokemon] + "\n";
        }
        pokedex += "}";

        let perks_list = "{\n";
        for (const [perkId, perkName] of Object.entries(POSSIBLE_PERKS)) {
          if (saveData[perkId] && Array.isArray(saveData[perkId])) {
            if (saveData[perkId].includes("" + statusPerson.id)) {
              perks_list += `\t${perkName}\n`;
            }
          }
          else if (saveData[perkId] == "" + statusPerson.id) {
            perks_list += `\t${perkName}\n`;
          }
        }
        perks_list += "}";

        msg.channel.send(
          `
**@${statusPerson.username}'s Status**:
*Overall points:* ${saveData[statusPerson.id]["points"] || 0}
*Weekly points:* ${saveData[statusPerson.id]["weekly_points"] || 0}
*Overall BARNABY points:* ${saveData[statusPerson.id]["barnaby_points"] || 0}
*Weekly BARNABY points:* ${saveData[statusPerson.id]["weekly_barnaby_points"] || 0}
*Pokedex:* ${pokedex == "{\n}" ? "No Pokedex" : pokedex}
*Perks:* ${perks_list == "{\n}" ? "No Perks" : perks_list}
`
        );
      }
    } catch (e) {
      msg.channel.send("No status found for @" + statusPerson.username);
    }
  }

  else if (cmd(msg, 'opt-out')) {
    setupDefaultsIfNecessary(saveData, msg.author.id, msg.author.username);
    saveData[msg.author.id]["wants-to-play"] = false;
    msg.channel.send("Successfully opted out for playing the game. Any catch messages that mention you will be deleted")
    save(saveData);
  }

  else if (cmd(msg, 'opt-in')) {
    setupDefaultsIfNecessary(saveData, msg.author.id, msg.author.username);
    saveData[msg.author.id]["wants-to-play"] = true;
    msg.channel.send("Successfully opted in to playing the game. Happy hunting :grin:");
    save(saveData);
  }

  else if (cmd(msg, 'off-limits')) {
    const result = "Here are all the people who do NOT want to be involved in the game:\n\n" +
      Object.values(saveData)
        .filter(user => user["wants-to-play"] != undefined && user["wants-to-play"] === false)
        .map(user => `\t**${user["username"]}**`)
        .join('\n') +
      "\n\nAny \"!catch\" messages that mention these people will be deleted";

    msg.channel.send(result);

  }

  else if (cmd(msg, 'catch')) {

    if (checkOffLimits(msg)) {
      return;
    }

    users_mentioned = msg.mentions.users.size;
    msg.mentions.users.forEach(caughtPersonID => {
      caughtPersonID = "" + caughtPersonID;
      let caughtPersonUsername = saveData[caughtPersonID]["username"];

      const catchCheck = isCatchAllowed(saveData, msg.author.id, caughtPersonID);
      if (!catchCheck.allowed) {
        msg.channel.send(`Catches between you and ${caughtPersonUsername} are still on cooldown for ${catchCheck.remainingTime} minute(s).`);
        return;
      }

      if ("" + msg.author.id === caughtPersonID) {
        askAI("A user has tried to 'catch' themselves. Ridicule them for attempting such a ridiculous thing.", msg.author.id)
          .then(response => sendLongMessage(msg.channel, response));
      } else {
        const currentGuild = client.guilds.cache.get(process.env.GUILD_ID);
        currentGuild.members.fetch(caughtPersonID).then(person => {

          let multiplier = handleSpecialPerks(saveData, msg, msg.author.id, caughtPersonID);

          if (person.roles.cache.some(role => role.name === "Shiny")) {
            awardPointsAndSendMessage(saveData, msg, msg.author.id, caughtPersonID, "Shiny", 10, multiplier);
          } else if (person.roles.cache.some(role => role.name === "Rare")) {
            awardPointsAndSendMessage(saveData, msg, msg.author.id, caughtPersonID, "Rare", 5, multiplier);
          } else if (person.roles.cache.some(role => role.name === "Uncommon")) {
            awardPointsAndSendMessage(saveData, msg, msg.author.id, caughtPersonID, "Uncommon", 3, multiplier);
          } else {
            awardPointsAndSendMessage(saveData, msg, msg.author.id, caughtPersonID, "Normal", 1, multiplier);
          }

        }).catch(console.error);
      }
    });
  }

  else if (cmd(msg, 'leaderboard')) {
    saveData = load(saveData);

    // Filter and validate
    const users = Object.values(saveData)
      .filter(user => user && typeof user === 'object' && user["wants-to-play"]);

    if (users.length === 0) {
      await msg.channel.send("No users found");
      return;
    }

    let messageContent = "";

    // Get the top users for various categories
    const topUsersByPoints = users.sort((a, b) => b["points"] - a["points"]).slice(0, 10);
    const topUsersByBarnabyPoints = users.sort((a, b) => b["barnaby_points"] - a["barnaby_points"]).slice(0, 10);

    // Append leaderboard messages
    messageContent += "Here is the overall TOTAL point leaderboard!:\n" +
      topUsersByPoints.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["points"]}`).join('\n') + "\n\n";

    messageContent += "Here is the overall BARNABY point leaderboard!:\n" +
      topUsersByBarnabyPoints.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["barnaby_points"]}`).join('\n');

    sendLongMessage(msg.channel, messageContent);

    // Only send the overall total point/barnaby point leaderboard and not any weekly leaderboards because its more suspensful that way
  }

  else if (cmd(msg, 'add-points')) {
    const addOverallPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, addOverallPointsPerson, pointAmount, "+", "");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'subtract-points')) {
    const subtractOverallPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, subtractOverallPointsPerson, pointAmount, "-", "");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'add-weekly-points')) {
    const addPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, addPointsPerson, pointAmount, "+", "weekly_");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'subtract-weekly-points')) {
    const subtractWeeklyPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, subtractWeeklyPointsPerson, pointAmount, "-", "weekly_");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'add-barnaby-points')) {
    const addBarnabyPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, addBarnabyPointsPerson, pointAmount, "+", "barnaby_");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'subtract-barnaby-points')) {
    const subtractBarnabyPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, subtractBarnabyPointsPerson, pointAmount, "-", "barnaby_");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'add-weekly-barnaby-points')) {
    const addBarnabyPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, addBarnabyPointsPerson, pointAmount, "+", "weekly_barnaby_");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'subtract-weekly-barnaby-points')) {
    const subtractBarnabyWeeklyPointsPerson = msg.mentions.users.first();
    const pointAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);

    const response = await adjustPoints(saveData, msg, subtractBarnabyWeeklyPointsPerson, pointAmount, "-", "weekly_barnaby_");
    msg.channel.send(response);
  }

  else if (cmd(msg, 'get-rarity')) {
    let getRarityPerson = msg.mentions.users.first();

    if (!getRarityPerson) {
      getRarityPerson = msg.author;
    }
    msg.channel.send(`${getRarityPerson.username} has a rarity value of ${saveData["" + getRarityPerson.id]["rarityValue"]}`);
  }

  else if (cmd(msg, 'set-rarity')) {
    const setRarityPerson = msg.mentions.users.first();
    const setRarityAmount = parseInt(msg.content.replace(/\s+/g, ' ').split(' ')[2]);
    setRarity(msg, setRarityPerson, setRarityAmount);
  }

  else if (cmd(msg, 'next-season')) {
    if (msg.member.roles.cache.some(role => role.name === 'PokemonBotManager') || msg.author.id === process.env.AUTHOR_ID) {

      saveData = load(saveData);

      const seasons = ["SUMMER", "FALL", "WINTER", "SPRING"];
      const emojis = [":sunny:", ":fallen_leaf:", ":snowflake:", ":herb:"];

      // Get the current season index and calculate the next season
      let currentSeasonIndex = seasons.indexOf(saveData["SEASON_ID"] || "SUMMER");
      let nextSeasonIndex = (currentSeasonIndex + 1) % seasons.length;

      saveData["SEASON_ID"] = seasons[nextSeasonIndex];
      saveData["SEASON_EMOJI"] = emojis[nextSeasonIndex];

      save(saveData);

      msg.channel.send(`Welcome to the next season! The season ID is: ${saveData["SEASON_ID"]} and the season emoji is: ${saveData["SEASON_EMOJI"]}`);
    } else {
      msg.channel.send("You are not a PokemonBotManager :eyes:");
    }
  }

  else if (cmd(msg, 'trigger-rarity-increase')) {
    if (msg.member.roles.cache.some(role => role.name === 'PokemonBotManager') || msg.author.id === process.env.AUTHOR_ID) {
      increaseRarity();
    } else {
      msg.channel.send("You are not a PokemonBotManager :eyes:");
    }
  }

  else if (cmd(msg, 'trigger-perk-update')) {
    if (msg.member.roles.cache.some(role => role.name === 'PokemonBotManager') || msg.author.id === process.env.AUTHOR_ID) {
      perkUpdate();
    } else {
      msg.channel.send("You are not a PokemonBotManager :eyes:");
    }
  }

})

client.login(process.env.TOKEN);