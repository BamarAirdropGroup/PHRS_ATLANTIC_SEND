require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const { HttpsProxyAgent } = require("https-proxy-agent");
const randomUseragent = require("random-useragent");
const axios = require("axios");
const prompt = require("prompt-sync")({ sigint: true });

const colors = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  bold: "\x1b[1m",
};

const logger = {
  info: (msg) => console.log(`${colors.green}[✓] ${msg}${colors.reset}`),
  wallet: (msg) => console.log(`${colors.yellow}[➤] ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}[✗] ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
  loading: (msg) => console.log(`${colors.cyan}[⟳] ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.white}[➤] ${msg}${colors.reset}`),
  user: (msg) => console.log(`\n${colors.white}[➤] ${msg}${colors.reset}`),
  banner: () => {
    console.log(`${colors.cyan}${colors.bold}`);
    console.log("-------------------------------------------------");
    console.log(" Pharos Testnet Transfer task");
    console.log("-------------------------------------------------");
    console.log(`${colors.reset}\n`);
  },
};

const networkConfig = {
  name: "Pharos Testnet",
  chainId: 688689,
  rpcUrl:
    "https://atlantic.dplabs-internal.com",
  currencySymbol: "PHRS",
};


const loadProxies = () => {
  try {
    const proxies = fs
      .readFileSync("proxies.txt", "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
    return proxies;
  } catch (error) {
    logger.warn(
      "No proxies.txt found or failed to load, switching to direct mode"
    );
    return [];
  }
};

const getRandomProxy = (proxies) => {
  return proxies[Math.floor(Math.random() * proxies.length)];
};

const setupProvider = (proxy = null) => {
  if (proxy) {
    logger.info(`Using proxy: ${proxy}`);
    const agent = new HttpsProxyAgent(proxy);
    return new ethers.JsonRpcProvider(
      networkConfig.rpcUrl,
      {
        chainId: networkConfig.chainId,
        name: networkConfig.name,
      },
      {
        fetchOptions: { agent },
        headers: { "User-Agent": randomUseragent.getRandom() },
      }
    );
  } else {
    logger.info("Using direct mode (no proxy)");
    return new ethers.JsonRpcProvider(networkConfig.rpcUrl, {
      chainId: networkConfig.chainId,
      name: networkConfig.name,
    });
  }
};

const waitForTransactionWithRetry = async (
  provider,
  txHash,
  maxRetries = 10,
  baseDelayMs = 1000
) => {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        return receipt;
      }
      logger.warn(
        `Transaction receipt not found for ${txHash}, retrying (${
          retries + 1
        }/${maxRetries})...`
      );
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * Math.pow(2, retries))
      );
      retries++;
    } catch (error) {
      logger.error(
        `Error fetching transaction receipt for ${txHash}: ${error.message}`
      );
      if (error.code === -32008) {
        logger.warn(
          `RPC error -32008, retrying (${retries + 1}/${maxRetries})...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, baseDelayMs * Math.pow(2, retries))
        );
        retries++;
      } else {
        throw error;
      }
    }
  }
  throw new Error(
    `Failed to get transaction receipt for ${txHash} after ${maxRetries} retries`
  );
};



const getUserInfo = async (wallet, proxy = null, jwt) => {
  try {
    logger.user(`Fetching user info for wallet: ${wallet.address}`);
    const profileUrl = `https://api.pharosnetwork.xyz/user/profile?address=${wallet.address}`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: `Bearer ${jwt}`,
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: "get",
      url: profileUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading("Fetching user profile...");
    const response = await axios(axiosConfig);
    const data = response.data;

    if (data.code !== 0 || !data.data.user_info) {
      logger.error(`Failed to fetch user info: ${data.msg || "Unknown error"}`);
      return;
    }

    const userInfo = data.data.user_info;
    logger.info(`User ID: ${userInfo.ID}`);
    logger.info(`Task Points: ${userInfo.TaskPoints}`);
    logger.info(`Total Points: ${userInfo.TotalPoints}`);
  } catch (error) {
    logger.error(`Failed to fetch user info: ${error.message}`);
  }
};

const verifyTask = async (wallet, proxy, jwt, txHash) => {
  try {
    logger.step(`Verifying task ID 401 for transaction: ${txHash}`);

    const verifyUrl = `https://api.pharosnetwork.xyz/task/verify`;

    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json", // <- Required for JSON POST
      priority: "u=1, i",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const payload = {
      address: wallet.address,
      task_id: 401,
      tx_hash: txHash,
    };

    const axiosConfig = {
      method: "post",
      url: verifyUrl,
      headers,
      data: payload,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
    };

    logger.loading("Sending task verification request...");
    const response = await axios(axiosConfig);
    const data = response.data;

    if (data.code === 0 && data.data?.verified) {
      logger.success(`Task ID 401 verified successfully for ${txHash}`);
      return true;
    } else {
      logger.warn(`Task verification failed: ${data.msg || "Unknown error"}`);
      return false;
    }
  } catch (error) {
    logger.error(`Task verification failed for ${txHash}: ${error.message}`);
    return false;
  }
};




const transferPHRS = async (wallet, provider, index, jwt, proxy) => {
  try {
    const amount = parseFloat(
      (Math.random() * (0.0000099 - 0.0000001) + 0.00001).toFixed(5)
    );
    const randomWallet = ethers.Wallet.createRandom();
    const toAddress = randomWallet.address;
    logger.step(
      `Preparing PHRS transfer ${index + 1}: ${amount} PHRS to ${toAddress}`
    );

    const balance = await provider.getBalance(wallet.address);
    const required = ethers.parseEther(amount.toString());

    if (balance < required) {
      logger.warn(
        `Skipping transfer ${
          index + 1
        }: Insufficient PHRS balance: ${ethers.formatEther(
          balance
        )} < ${amount}`
      );
      return;
    }

    const feeData = await provider.getFeeData();

    // Build transaction options dynamically based on available fee data
    const txOptions = {
      to: toAddress,
      value: required,
      gasLimit: 21000,
    };

    if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
      txOptions.maxFeePerGas = feeData.maxFeePerGas;
      txOptions.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    } else {
      txOptions.gasPrice = feeData.gasPrice || ethers.parseUnits("1", "gwei");
    }

    const tx = await wallet.sendTransaction(txOptions);

    logger.loading(
      `Transfer transaction ${index + 1} sent, waiting for confirmation...`
    );
    const receipt = await waitForTransactionWithRetry(provider, tx.hash);
    logger.success(`Transfer ${index + 1} completed: ${receipt.hash}`);
    logger.step(`Explorer: https://atlantic.pharosscan.xyz/tx/${receipt.hash}`);

    await verifyTask(wallet, proxy, jwt, receipt.hash);
  } catch (error) {
    logger.error(`Transfer ${index + 1} failed: ${error.message}`);
    if (error.transaction) {
      logger.error(
        `Transaction details: ${JSON.stringify(error.transaction, null, 2)}`
      );
    }
    if (error.receipt) {
      logger.error(`Receipt: ${JSON.stringify(error.receipt, null, 2)}`);
    }
  }
};



const claimFaucet = async (wallet, proxy = null) => {
  try {
    logger.step(`Checking faucet eligibility for wallet: ${wallet.address}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`Signed message: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=S6NGMzXSCDBxhnwo`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: "post",
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading("Sending login request for faucet...");
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(
        `Login failed for faucet: ${loginData.msg || "Unknown error"}`
      );
      return false;
    }

    const jwt = loginData.data.jwt;
    logger.success(`Login successful for faucet, JWT: ${jwt}`);

    const statusUrl = `https://api.pharosnetwork.xyz/faucet/status?address=${wallet.address}`;
    const statusHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading("Checking faucet status...");
    const statusResponse = await axios({
      method: "get",
      url: statusUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const statusData = statusResponse.data;

    if (statusData.code !== 0 || !statusData.data) {
      logger.error(
        `Faucet status check failed: ${statusData.msg || "Unknown error"}`
      );
      return false;
    }

    if (!statusData.data.is_able_to_faucet) {
      const nextAvailable = new Date(
        statusData.data.avaliable_timestamp * 1000
      ).toLocaleString("en-US", { timeZone: "Asia/Makassar" });
      logger.warn(`Faucet not available until: ${nextAvailable}`);
      return false;
    }

    const claimUrl = `https://api.pharosnetwork.xyz/faucet/daily?address=${wallet.address}`;
    logger.loading("Claiming faucet...");
    const claimResponse = await axios({
      method: "post",
      url: claimUrl,
      headers: statusHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const claimData = claimResponse.data;

    if (claimData.code === 0) {
      logger.success(`Faucet claimed successfully for ${wallet.address}`);
      return true;
    } else {
      logger.error(`Faucet claim failed: ${claimData.msg || "Unknown error"}`);
      return false;
    }
  } catch (error) {
    logger.error(`Faucet claim failed for ${wallet.address}: ${error.message}`);
    return false;
  }
};

const performCheckIn = async (wallet, proxy = null) => {
  try {
    logger.step(`Performing daily check-in for wallet: ${wallet.address}`);

    const message = "pharos";
    const signature = await wallet.signMessage(message);
    logger.step(`Signed message: ${signature}`);

    const loginUrl = `https://api.pharosnetwork.xyz/user/login?address=${wallet.address}&signature=${signature}&invite_code=MLzWEEaMRkelykQa`;
    const headers = {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.8",
      authorization: "Bearer null",
      "sec-ch-ua": '"Chromium";v="136", "Brave";v="136", "Not.A/Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "sec-gpc": "1",
      Referer: "https://testnet.pharosnetwork.xyz/",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent": randomUseragent.getRandom(),
    };

    const axiosConfig = {
      method: "post",
      url: loginUrl,
      headers,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    };

    logger.loading("Sending login request...");
    const loginResponse = await axios(axiosConfig);
    const loginData = loginResponse.data;

    if (loginData.code !== 0 || !loginData.data.jwt) {
      logger.error(`Login failed: ${loginData.msg || "Unknown error"}`);
      return null;
    }

    const jwt = loginData.data.jwt;
    logger.success(`Login successful, JWT: ${jwt}`);

    const checkInUrl = `https://api.pharosnetwork.xyz/sign/in?address=${wallet.address}`;
    const checkInHeaders = {
      ...headers,
      authorization: `Bearer ${jwt}`,
    };

    logger.loading("Sending check-in request...");
    const checkInResponse = await axios({
      method: "post",
      url: checkInUrl,
      headers: checkInHeaders,
      httpsAgent: proxy ? new HttpsProxyAgent(proxy) : null,
    });
    const checkInData = checkInResponse.data;

    if (checkInData.code === 0) {
      logger.success(`Check-in successful for ${wallet.address}`);
      return jwt;
    } else {
      logger.warn(
        `Check-in failed, possibly already checked in: ${
          checkInData.msg || "Unknown error"
        }`
      );
      return jwt;
    }
  } catch (error) {
    logger.error(`Check-in failed for ${wallet.address}: ${error.message}`);
    return null;
  }
};



const getUserDelay = () => {
  let delayMinutes = process.env.DELAY_MINUTES;
  if (!delayMinutes) {
    delayMinutes = prompt("Enter delay between cycles in minutes (e.g., 30): ");
  }
  const minutes = parseInt(delayMinutes, 10);
  if (isNaN(minutes) || minutes <= 0) {
    logger.error("Invalid delay input, using default 30 minutes");
    return 30;
  }
  return minutes;
};

const countdown = async (minutes) => {
  const totalSeconds = minutes * 60;
  logger.info(`Starting ${minutes}-minute countdown...`);

  for (let seconds = totalSeconds; seconds >= 0; seconds--) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    process.stdout.write(
      `\r${colors.cyan}Time remaining: ${mins}m ${secs}s${colors.reset} `
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  process.stdout.write("\rCountdown complete! Restarting process...\n");
};

const main = async () => {
  logger.banner();

  const delayMinutes = getUserDelay();
  logger.info(`Delay between cycles set to ${delayMinutes} minutes`);

  const proxies = loadProxies();
  const privateKey = Array.from(
    { length: 25 },
    (_, i) => process.env[`PRIVATE_KEY_${i + 1}`]
  );
  const privateKeys = privateKey.filter((pk) => pk);
  if (!privateKeys.length) {
    logger.error("No private keys found in .env");
    return;
  }

  const numTransfers = 120;

  while (true) {
    for (const privateKey of privateKeys) {
      const proxy = proxies.length ? getRandomProxy(proxies) : null;
      const provider = setupProvider(proxy);
      const wallet = new ethers.Wallet(privateKey, provider);

      logger.wallet(`Using wallet: ${wallet.address}`);

      await claimFaucet(wallet, proxy);

      const jwt = await performCheckIn(wallet, proxy);
      if (jwt) {
        await getUserInfo(wallet, proxy, jwt);
      } else {
        logger.error("Skipping user info fetch due to failed check-in");
      }

      console.log(`\n${colors.cyan}------------------------${colors.reset}`);
      console.log(`${colors.cyan}TRANSFERS${colors.reset}`);
      console.log(`${colors.cyan}------------------------${colors.reset}`);
      for (let i = 0; i < numTransfers; i++) {
        await transferPHRS(wallet, provider, i, jwt, proxy);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.random() * 2000 + 1000)
        );
      }
    }

    logger.success("All actions completed for all wallets!");
    await countdown(delayMinutes);
  }
};

main().catch((error) => {
  logger.error(`Bot failed: ${error.message}`);
  process.exit(1);
});
