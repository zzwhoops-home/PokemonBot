// All helper functions for index.js
const express = require('express')
const app = express()
const fs = require('fs')
var cron = require('node-cron')
require("dotenv").config()

const { OpenAI } = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPEN_AI_TOKEN,
});

const discord = require('discord.js')
const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ]
});

var saveData;
global.saveData = load();

function cmd(msg, command_string) {
  return msg.content.toLowerCase().includes("!" + command_string);
}

async function askAI(prompt, author_id) {
  return "You caught the guy!" + JSON.stringify({ prompt, author_id }); // Placeholder response for testing without API calls
  const response = await openai.chat.completions.create({
    messages: [{ role: "system", content: "You are an announcer in an online Pokemon-like game where several users attempt to \"catch\" various Pokemon and obtain points based on the rarity value of the Pokemon they catch, as well as add those Pokemon to their \"Pokedex\". Keep all following answers to a very short, concise paragraph. You personality should be: " + saveData[author_id]["AIPersonality"] + ". Make sure to answer all following prompts heavily flavored with your personality" },
    { role: "user", content: prompt }],
    model: "gpt-4o-turbo",
  });
  return response.choices[0].message.content;
}

async function adjustPoints(saveData, msg, user, amount, pointSign, pointPrefix) {
  if (!(msg.member.roles.cache.some(role => role.name === 'PokemonBotManager') || "" + msg.author.id === process.env.AUTHOR_ID)) {
    return "You are not a PokémonBotManager :eyes:";
  }

  if (checkOffLimits(msg)) {
    return;
  }

  if (!user || checkOffLimits(msg)) {
    return "No user mentioned, please specify a person.";
  }

  if (isNaN(amount) || amount <= 0) {
    return "Please specify a valid number of points.";
  }

  if (saveData[user.id] === undefined) {
    setupDefaultsIfNecessary(saveData, user.id, user.username);
  }

  if (pointSign == "+") {
    saveData[user.id][pointPrefix + "points"] = saveData[user.id][pointPrefix + "points"] + amount;
    save(saveData);
    return `Added ${amount} points to ${user.username}'s "${pointPrefix}points" for a total of ${saveData[user.id][pointPrefix + "points"]}.`;
  } else {
    saveData[user.id][pointPrefix + "points"] = saveData[user.id][pointPrefix + "points"] - amount;
    save(saveData);
    return `Subtracted ${amount} points from ${user.username}'s "${pointPrefix}points" for a total of ${saveData[user.id][pointPrefix + "points"]}`;
  }
}

function setRarity(msg, setRarityPerson, amount) {
  if (!msg.member.roles.cache.some(role => role.name === 'PokemonBotManager') && "" + msg.author.id !== process.env.AUTHOR_ID) {
    return msg.channel.send("You are not a PokemonBotManager :eyes:");
  }

  if (checkOffLimits(msg)) {
    return;
  }

  if (!setRarityPerson) {
    return msg.channel.send("No user mentioned, please specify a person.");
  }

  // unnecessary but I'm keeping it here in case
  setupDefaultsIfNecessary(saveData, setRarityPerson.id, setRarityPerson.username);

  if (saveData["" + setRarityPerson.id]["rarityValue"] === 0 && amount < 0) {
    msg.channel.send(`${setRarityPerson.username}'s rarity value is already at the minimum value of 0.`);
  } else {
    saveData["" + setRarityPerson.id]["rarityValue"] = amount;
    msg.channel.send(`Set ${setRarityPerson.username}'s rarity value to ${amount}`);
    save(saveData);
  }
}

function increaseRarity() {
  saveData = load();
  console.log("triggering-rarity-increase");

  const roleActions = [
    { threshold: 30, add: "Shiny", remove: ["Rare"] },
    { threshold: 14, add: "Rare", remove: ["Uncommon"] },
    { threshold: 7, add: "Uncommon", remove: [] },
  ];

  const removeRolesBelowThreshold = ["Uncommon", "Rare", "Shiny"];

  for (let user_id of Object.keys(saveData)) {
    let user_id_num = Number(user_id);

    // if the user_id is only numbers and the user wants to play
    if (!isNaN(user_id_num) && saveData[user_id]["wants-to-play"] === true) {

      const currentGuild = client.guilds.cache.find(g => g.id == process.env.GUILD_ID);

      currentGuild.members.fetch(user_id).then(member => {

        const userRarityValue = saveData[user_id]["rarityValue"];

        // Fetch the roles once
        const rolesCache = member.guild.roles.cache;

        // Assign roles based on the user's rarity value
        roleActions.forEach(action => {
          if (userRarityValue >= action.threshold) {
            let addRole = rolesCache.find(role => role.name === action.add);
            if (addRole) member.roles.add(addRole);
            action.remove.forEach(roleName => {
              let removeRole = rolesCache.find(role => role.name === roleName);
              if (removeRole) member.roles.remove(removeRole);
            });
          }
        });

        // Remove all roles if the rarity value is below 7
        if (userRarityValue < 7) {
          removeRolesBelowThreshold.forEach(roleName => {
            let role = rolesCache.find(r => r.name === roleName);
            if (role && member.roles.cache.has(role.id)) {
              member.roles.remove(role);
            }
          });
        }

        // Increment the user's rarity value
        saveData[user_id]["rarityValue"] += 1;
        save(saveData);
      }).catch(error => console.log(error));
    }
  }
}

// function to split up messages to send separately, to avoid issues with discord's limit of 2000 characters.
function splitMessage(str, size) {
  const numChunks = Math.ceil(str.length / size);
  const chunks = new Array(numChunks);

  for (let i = 0, c = 0; i < numChunks; ++i, c += size) {
    chunks[i] = str.substr(c, size);
  }
  return chunks;
}


// Function to send a long message in chunks
function sendLongMessage(channel, message) {
  const messageChunks = splitMessage(message, Number(process.env.MAX_MESSAGE_LENGTH_BEFORE_SPLIT));

  messageChunks.forEach(chunk => {
    channel.send(chunk).catch(console.error);
  });
}

function setupDefaultsIfNecessary(saveData, userID, userUsername) {
  try {
    if (saveData[userID] === undefined) {
      saveData[userID] = { "id": userID, "points": 0, "weekly_points": 0, "barnaby_points": 0, "weekly_barnaby_points": 0, "username": userUsername, "pokedex": {}, "wants-to-play": true, "rarityValue": 0, "AIPersonality": "Pokemon Announcer" };
      save(saveData);
      return true;
    }
  } catch (e) {
    console.log("Error, player likely already registered");
    return false;
  }
}

function checkOffLimits(msg) {
  saveData = load();
  let isOffLimits = false;
  for (let Person of msg.mentions.users) {
    let person = Person[1];
    if (!saveData["" + person.id] || saveData["" + person.id]["wants-to-play"] == false) {
      isOffLimits = true;
      break;
    }
  }
  if (isOffLimits) {
    msg.channel.send("There was someone mentioned in your message that has not registered or has opted out from playing the game!");
    msg.delete();
    return true;
  }
  return false;
}

function load() {
  try {
    var saveData = JSON.parse(fs.readFileSync('./save-data.json', 'utf8'));
  } catch (e) {
    // init if no data found
    var saveData = {
      "SEASON_ID": "WINTER",
      "SEASON_EMOJI": ":snowflake:",
      "PLOT_ARMOR_PERSON_ID": undefined,
      "DYNAMAX_PEOPLE_ID": [],
      "VERMIN_WHISPERER_PERSON_ID": undefined,
      "SWIPER_PEOPLE_ID": [],
      "BOUNTY_PERSON_ID": undefined,
      "catchCooldowns": {}
    }
  }
  return saveData;
}

function save(saveData) {
  fs.writeFileSync('./save-data.json', JSON.stringify(saveData));
}

function awardPointsAndSendMessage(saveData, msg, catcherID, caughtPersonID, rarity, basePoints, multiplier) {

  // If this is a PLOT ARMOR case
  if (multiplier == null) {
    // STILL set the cooldown even after a failed catch
    setCatchCooldown(saveData, msg.author.id, caughtPersonID);
    return;
  }

  let pointsAwarded = basePoints * multiplier;

  catcherUsername = saveData["" + catcherID]["username"];
  caughtPersonUsername = saveData["" + caughtPersonID]["username"];

  // Check if caughtPerson is a Barnaby catch 
  if (msg.mentions.users.size == 1 && ("" + caughtPersonID === process.env.BARNABY_ID)) {
    // Find the amount of unique attachments in the catch message
    const uniqueAttachments = new Set();
    msg.attachments.forEach(attachment => {
      uniqueAttachments.add(attachment.url);
    });
    let attachment_limit = Number(process.env.BARNABY_ATTACHMENT_LIMIT);
    if (uniqueAttachments.size > attachment_limit) {
      // Limit the attachments
      msg.channel.send("Sorry! The limit for BARNABY attachments is " + attachment_limit + " so only " + attachment_limit + " of the provided attachments will count.")
    }
    // award points, making sure at least one point is added and 1 attachment = 1 point * multiplier
    pointsAwarded = ((basePoints - 1) + Math.max(1, Math.min(uniqueAttachments.size, attachment_limit))) * multiplier;
    // Keep track of barnaby points for perk reasons. Actual points are also recorded further below
    saveData["" + catcherID]["barnaby_points"] += pointsAwarded;
    saveData["" + catcherID]["weekly_barnaby_points"] += pointsAwarded;

    // Send the catch AI message for Barnaby catch
    askAI(`User @${catcherUsername} has caught ${uniqueAttachments.size} of a specially abundant type of Pokémon called "BARNABY" Pokémon and received ${pointsAwarded} points! Describe the catch, while playfully ridiculing the caught BARNABY personality, which is: ${saveData["" + caughtPersonID]["AIPersonality"]}`, catcherID)
      .then(response => sendLongMessage(msg.channel, response));

  } else {

    // Send the catch AI message
    askAI(`User @${catcherUsername} has caught the ${rarity}-rarity Pokémon @${caughtPersonUsername} and received ${pointsAwarded} points! Describe the catch, while playfully ridiculing the caught Pokémon's personality, which is: ${saveData[caughtPersonID]["AIPersonality"]}`, catcherID)
      .then(response => sendLongMessage(msg.channel, response));
  }

  // Add points to the catcher
  saveData["" + catcherID]["points"] += pointsAwarded;
  saveData["" + catcherID]["weekly_points"] += pointsAwarded;

  // Deduct half the base points from the caught person (minimum of 1)
  const deduction = Math.max(Math.floor(basePoints / 2), 1);
  // Only deduct TOTAL points
  saveData["" + caughtPersonID]["points"] -= deduction;

  // Update the catcher's Pokedex

  const pokemonEntry = `${saveData["SEASON_EMOJI"]} ${caughtPersonUsername} ${saveData["SEASON_EMOJI"]}`;

  // Increment the Pokedex entry (first initialize if necessary)
  saveData["" + msg.author.id]["pokedex"][pokemonEntry] = saveData[msg.author.id]["pokedex"][pokemonEntry] || 0
  saveData["" + msg.author.id]["pokedex"][pokemonEntry] += 1;

  // Reset the rarity value of the caught person
  saveData["" + caughtPersonID]["rarityValue"] = 0;

  // Set the cooldown after a successful catch
  setCatchCooldown(saveData, msg.author.id, caughtPersonID);

  save(saveData);
}

function handleSpecialPerks(saveData, msg, catcherID, caughtPersonID) {
  let multiplier = 1;

  setupDefaultsIfNecessary(saveData, "" + msg.author.id, msg.author.username);

  catcherUsername = saveData["" + catcherID]["username"];
  caughtPersonUsername = saveData["" + caughtPersonID]["username"];

  // Plot Armor Perk
  if (caughtPersonID === saveData["PLOT_ARMOR_PERSON_ID"]) {
    saveData["PLOT_ARMOR_PERSON_ID"] = "";
    msg.channel.send(`@${caughtPersonUsername} has used their PLOT ARMOR perk to avoid being caught!`);
    // Have to save here because of return
    save(saveData);
    return null; // Return null meaning the catch was unsuccessful
  }

  // Dynamax Perk
  const dynamaxIndex = saveData["DYNAMAX_PEOPLE_ID"].indexOf("" + catcherID);
  if (dynamaxIndex !== -1) {
    multiplier *= 3;
    // Use up Dynamax Perk
    saveData["DYNAMAX_PEOPLE_ID"][dynamaxIndex] = undefined;
    msg.channel.send(`@${catcherUsername} has used their DYNAMAX perk to triple their points from this catch!`);
  }

  // Vermin Whisperer Perk
  if (caughtPersonID === saveData["VERMIN_WHISPERER_PERSON_ID"]) {
    let deductedPoints = Number(process.env.VERMIN_STEAL_AMOUNT);
    msg.channel.send(`@${catcherUsername} has caught @${caughtPersonUsername}, who has the VERMIN WHISPERER perk, which steals ${deductedPoints} point(s) from @${catcherUsername}'s TOTAL points!`);

    saveData[caughtPersonID]["points"] += deductedPoints;
    saveData[caughtPersonID]["weekly_points"] += deductedPoints;
    // Only deduct from TOTAL points
    saveData[catcherID]["points"] -= deductedPoints;
  }

  // Swiper Perk
  const swiperIndex = saveData["SWIPER_PEOPLE_ID"].indexOf("" + catcherID);
  if (swiperIndex !== -1) {
    // Use up the Swiper perk
    steal_percentage = Number(process.env.SWIPER_STEAL_PERCENTAGE);
    saveData["SWIPER_PEOPLE_ID"][swiperIndex] = undefined;
    let stolenPoints = Math.max(Math.floor(saveData[caughtPersonID]["points"] * (steal_percentage / 100)), 1);
    msg.channel.send(`@${catcherUsername} has used their SWIPER perk to steal ${stolenPoints} (${steal_percentage}%) of @${caughtPersonUsername}'s TOTAL points!`);

    saveData[catcherID]["points"] += stolenPoints;
    saveData[catcherID]["weekly_points"] += stolenPoints;
    // Only deduct from TOTAl points
    saveData[caughtPersonID]["points"] -= stolenPoints;
  }

  // Bounty Perk
  if (saveData["BOUNTY_PERSON_ID"] === "" + catcherID) {
    multiplier *= 2;
    msg.channel.send(`${catcherUsername} has the BOUNTY perk, which has doubled their points from this catch!`);
  } else if (saveData["BOUNTY_PERSON_ID"] === caughtPersonID) {
    multiplier *= 2;
    saveData["BOUNTY_PERSON_ID"] = "";
    msg.channel.send(`@${catcherUsername} has caught a Pokémon with the BOUNTY perk, doubling their points! @${caughtPersonUsername} has been caught, removing their BOUNTY perk.`);
  }

  save(saveData);

  return multiplier;
}

// Function to check if a catch is allowed based on cooldowns
function isCatchAllowed(saveData, catcherId, caughtId) {
  if (saveData["catchCooldowns"] === undefined) {
    saveData["catchCooldowns"] = {};
  }

  const key = `${catcherId}-${caughtId}`;
  const reverseKey = `${caughtId}-${catcherId}`;

  const nowInMinutes = Math.ceil(Date.now() / (60 * 1000));
  const cooldownExpiry = saveData["catchCooldowns"][key] || saveData["catchCooldowns"][reverseKey];

  if (!cooldownExpiry) {
    return { allowed: true };
  }
  else if (nowInMinutes < cooldownExpiry) {
    const remainingTimeMinutes = cooldownExpiry - nowInMinutes;
    // Return two data points: That the catch isn't allowed and also how much remaining time until the cooldown is over
    return { allowed: false, remainingTime: remainingTimeMinutes };
  }
  // Remove the expired cooldown record to keep the database clean
  delete saveData["catchCooldowns"][key];
  delete saveData["catchCooldowns"][reverseKey];
  save(saveData);
  // Return that the catch is allowed
  return { allowed: true };
}

// Function to set a cooldown for a catch
function setCatchCooldown(saveData, catcherId, caughtId) {
  const cooldownDurationInMinutes = Number(process.env.COOLDOWN_MINUTES);
  const key = `${catcherId}-${caughtId}`;
  const reverseKey = `${caughtId}-${catcherId}`;
  const nowInMinutes = Math.ceil(Date.now() / (60 * 1000));
  const expiryTime = nowInMinutes + cooldownDurationInMinutes;

  if (saveData["catchCooldowns"] === undefined) {
    saveData["catchCooldowns"] = {};
  }
  saveData["catchCooldowns"][key] = expiryTime;
  saveData["catchCooldowns"][reverseKey] = expiryTime;
  save(saveData);
}

function dubPlotArmor(saveData, PLOT_ARMOR_PERSON) {
  saveData["PLOT_ARMOR_PERSON_ID"] = "" + PLOT_ARMOR_PERSON.id;
  return saveData;
}

function dubDynamax(saveData, DYNAMAX_PERSON) {
  // Ensure saveData["DYNAMAX_PEOPLE_ID"] is initialized as an array
  if (!Array.isArray(saveData["DYNAMAX_PEOPLE_ID"])) {
    saveData["DYNAMAX_PEOPLE_ID"] = [];
  }
  saveData["DYNAMAX_PEOPLE_ID"].push("" + DYNAMAX_PERSON.id);
  return saveData;
}

function dubVerminWhisperer(saveData, VERMIN_WHISPERER_PERSON) {
  saveData["VERMIN_WHISPERER_PERSON_ID"] = "" + VERMIN_WHISPERER_PERSON.id;
  return saveData;
}

function dubSwiper(saveData, SWIPER_PERSON) {
  // Ensure saveData["SWIPER_PEOPLE_ID"] is initialized as an array
  if (!Array.isArray(saveData["SWIPER_PEOPLE_ID"])) {
    saveData["SWIPER_PEOPLE_ID"] = [];
  }
  saveData["SWIPER_PEOPLE_ID"].push("" + SWIPER_PERSON.id);
  return saveData;
}

function dubBounty(saveData, BOUNTY_PERSON) {
  saveData["BOUNTY_PERSON_ID"] = "" + BOUNTY_PERSON.id;
  return saveData;
}

async function perkUpdate() {
  saveData = load();
  try {
    const pokemon_channel = await client.channels.fetch(process.env.POKEMON_CHANNEL_ID);

    if (!pokemon_channel) {
      console.error("Pokemon channel not found.");
      return;
    }

    // Filter and validate
    const users = Object.values(saveData)
      .filter(user => user && typeof user === 'object' && user["wants-to-play"]);

    if (users.length === 0) {
      await pokemon_channel.send("No users found");
      return;
    }

    // Get the top users for various categories
    const topUsersByPoints = users.sort((a, b) => b["points"] - a["points"]).slice(0, 10);
    const topUsersByBarnabyPoints = users.sort((a, b) => b["barnaby_points"] - a["barnaby_points"]).slice(0, 10);
    const topUsersByWeeklyPoints = users.sort((a, b) => b["weekly_points"] - a["weekly_points"]).slice(0, 5);
    const topUsersByWeeklyBarnabyPoints = users.sort((a, b) => b["weekly_barnaby_points"] - a["weekly_barnaby_points"]).slice(0, 5);
    const topUsersByRarity = users.map(user => ({ ...user, rarity: user["rarityValue"] || 0 })).sort((a, b) => b["rarityValue"] - a["rarityValue"]).slice(0, 5);

    let messageContent = "**------------LEADERBOARD UPDATE------------**\n\n";

    // Append leaderboard messages
    messageContent += "Here is the overall TOTAL point leaderboard!:\n" +
      topUsersByPoints.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["points"]}`).join('\n') + "\n\n";

    messageContent += "Here is the overall BARNABY point leaderboard!:\n" +
      topUsersByBarnabyPoints.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["barnaby_points"]}`).join('\n') + "\n\n";

    messageContent += "Here is last week's overall point leaderboard!:\n" +
      topUsersByWeeklyPoints.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["weekly_points"]}`).join('\n') + "\n\n";

    messageContent += "Here is last week's BARNABY point leaderboard!:\n" +
      topUsersByWeeklyBarnabyPoints.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["weekly_barnaby_points"]}`).join('\n') + "\n\n";

    messageContent += "Here is last week's RARITY leaderboard!:\n" +
      topUsersByRarity.map((user, index) => `${index + 1}. **${user["username"]}**: ${user["rarityValue"]}`).join('\n') + "\n\n";

    messageContent += "**--------------PERKS AWARDED--------------**\n\n";

    // Plot Armor
    const topWeeklyUser = topUsersByWeeklyPoints[0];
    if (topWeeklyUser) {
      saveData = dubPlotArmor(saveData, topWeeklyUser);
      messageContent += `Winner of the **PLOT ARMOR** perk:\n- *${topWeeklyUser["username"]}*\n\n`;
    }

    saveData["DYNAMAX_PEOPLE_ID"] = [];
    // Dynamax
    messageContent += "Winners of the **DYNAMAX** perk:\n";
    topUsersByWeeklyPoints.slice(0, 3).forEach((user, index) => {
      saveData = dubDynamax(saveData, user);
      messageContent += `${index + 1}. *${user["username"]}*\n`;
    });
    messageContent += "\n";

    // Vermin Whisperer
    const topWeeklyBarnabyUser = topUsersByWeeklyBarnabyPoints[0];
    if (topWeeklyBarnabyUser) {
      saveData = dubVerminWhisperer(saveData, topWeeklyBarnabyUser);
      messageContent += `Winner of the **VERMIN WHISPERER** perk:\n- *${topWeeklyBarnabyUser["username"]}*\n\n`;
    }

    // Swiper
    saveData["SWIPER_PEOPLE_ID"] = [];
    messageContent += "Winners of the **SWIPER** perk:\n";
    topUsersByWeeklyBarnabyPoints.slice(0, 3).forEach((user, index) => {
      saveData = dubSwiper(saveData, user);
      messageContent += `${index + 1}. *${user["username"]}*\n`;
    });
    messageContent += "\n";

    // Bounty
    const topRarityValueUsers = users.map(user => user["rarityValue"] || 0);
    let topRarityValue = Math.max(...topRarityValueUsers);
    const tiedUsers = users.filter(user => user["rarityValue"] === topRarityValue);
    if (tiedUsers.length > 0) {
      const bountyWinner = tiedUsers[Math.floor(Math.random() * tiedUsers.length)];
      saveData = dubBounty(saveData, bountyWinner);
      messageContent += `Winner of the **BOUNTY** perk:\n- *${bountyWinner["username"]}*\n\n`;
    }

    // Clear weekly points and cooldowns
    users.forEach(user => {
      user["weekly_points"] = 0;
      user["weekly_barnaby_points"] = 0;
    });
    saveData["catchCooldowns"] = {};

    save(saveData);
    sendLongMessage(pokemon_channel, messageContent);

    console.log("Weekly points have been cleared for all players.");

  } catch (error) {
    console.error("An error occurred during the tournament update:", error);
  }
}




// Export all the functions needed
module.exports = {
  express,
  app,
  fs,
  cron,
  openai,
  discord,
  client,
  saveData,
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
  perkUpdate
};