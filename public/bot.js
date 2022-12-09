import http from "http";
import ethers from "ethers";
import express from "express";
import expressWs from "express-ws";
import fs from "fs";
import chalk from "chalk";
import path from "path";
import { fileURLToPath } from "url";
import BlocknativeSDK from "bnc-sdk";
import WebSocket from "ws";

const app = express();
const httpServer = http.createServer(app);
const wss = expressWs(app, httpServer);

const ERC20_ABI = [
  {
    constant: false,
    inputs: [
      { name: "_spender", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "success", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "totalSupply",
    outputs: [{ name: "supply", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_from", type: "address" },
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transferFrom",
    outputs: [{ name: "success", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "digits", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "success", type: "bool" }],
    payable: false,
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [
      { name: "_owner", type: "address" },
      { name: "_spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "remaining", type: "uint256" }],
    payable: false,
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "_owner", type: "address" },
      { indexed: true, name: "_spender", type: "address" },
      { indexed: false, name: "_value", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
];

let configurationU = JSON.parse(
  fs.readFileSync("configurationU.json", "utf-8")
);
let configurationP = JSON.parse(
  fs.readFileSync("configurationP.json", "utf-8")
);
let WETHABI = JSON.parse(fs.readFileSync("WETH.json", "utf-8"));
let WETHContract;
let uniswapV2ABI = JSON.parse(fs.readFileSync("uniswapV2.json", "utf-8"));
var botStatus = false;
var isStarted = false;
var txFunc;
var targetPrice;
var targetPriceDetected;
var targetToken;
var provider;
var wallet;
var account;
var router;
var tx;
var isBuy = false;
var lockedList = [];
var priceList = [];

async function sdkSetup(sdk, configuration) {
  const parsedConfiguration =
    typeof configuration === "string"
      ? JSON.parse(configuration)
      : configuration;
  const globalConfiguration = parsedConfiguration.find(
    ({ id }) => id === "global"
  );
  const addressConfigurations = parsedConfiguration.filter(
    ({ id }) => id !== "global"
  );

  // save global configuration first and wait for it to be saved
  globalConfiguration &&
    (await sdk.configuration({
      scope: "global",
      filters: globalConfiguration.filters,
    }));

  addressConfigurations.forEach(({ id, filters, abi }) => {
    const abiObj = abi ? { abi } : {};
    sdk.configuration({ ...abiObj, filters, scope: id, watchAddress: true });
  });
}

/////////////////////////////////////////////////////////////////////////////////////////////////////
//    This Part is really important.
/////////////////////////////////////////////////////////////////////////////////////////////////////
async function handleTransactionEvent(transaction) {
  if (!isBuy && botStatus) {
    try {
      tx = transaction.transaction;
      txFunc = tx.input.substring(0, 10);
      targetPriceDetected = targetPrice.lte(tx.value);
      if (
        (txFunc == "0xfb3bdb41" ||
          txFunc == "0xb6f9de95" ||
          txFunc == "0x7ff36ab5") &&
        targetPriceDetected &&
        tx.input.includes(targetToken)
      ) {
        console.log(chalk.red(`New Swap Event Catched : ${tx.hash}`));
        isBuy = true;
        const tokenIn = data.chainId === 1 ? data.WETH : data.WBNB;
        const tokenOut = ethers.utils.getAddress(data.tokenAddress);

        var amountIn = ethers.utils.parseUnits(
          `${data.AMOUNT_OF_WBNB.toString()}`,
          "ether"
        );
        console.log(chalk.green(amountIn.toString(), tokenIn, tokenOut));

        var amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
        //Our execution price will be a bit different, we need some flexbility
        var amountOutMin = amounts[1].sub(
          amounts[1].mul(`${data.Slippage}`).div(100)
        );

        console.log(
          chalk.green.inverse(`Liquidity Addition Detected\n`) +
            `Buying Token
              =================
              tokenIn: ${amountIn.toString()} ${tokenIn} 
              tokenOut: ${amountOutMin.toString()} ${tokenOut}
            `
        );

        let price = data.AMOUNT_OF_WBNB.toString();
        lockedList[0] = tokenOut;
        priceList[0] = price;

        //Buy token via swap router.
        const buy_tx = await router
          .swapExactETHForTokens(
            amountOutMin,
            [tokenIn, tokenOut],
            data.recipient,
            Date.now() + 1000 * 60 * 10, //10 minutes
            {
              gasLimit: data.gasLimit,
              gasPrice: ethers.utils.parseUnits(`${data.gasPrice}`, "gwei"),
              value: amountIn,
            }
          )
          .catch((err) => {
            console.log(err);
            console.log("transaction failed...");
          });

        let receipt = null;
        while (receipt === null) {
          try {
            receipt = await provider.getTransactionReceipt(buy_tx.hash);
          } catch (e) {
            // console.log(e)
          }
        }

        // append buy history into log.txt
        fs.appendFile(
          "log.txt",
          new Date().toISOString() +
            ": Preparing to buy token " +
            tokenIn +
            " " +
            amountIn +
            " " +
            tokenOut +
            " " +
            amountOutMin +
            "\n",
          function (err) {
            if (err) throw err;
          }
        );

        fs.appendFile(
          "tokenlist.txt",
          "\n" + tokenOut + " " + price,
          function (err) {
            if (err) throw err;
          }
        );

        // Send the response to the frontend so let the frontend display the event.
        var aWss = wss.getWss("/");
        aWss.clients.forEach(function (client) {
          var detectObj = {
            token: tokenOut,
            action: "Detected",
            price: price,
            transaction: tx.hash,
          };
          var detectInfo = JSON.stringify(detectObj);
          client.send(detectInfo);
          var obj = {
            token: tokenOut,
            action: "Buy",
            price: price,
            transaction: buy_tx.hash,
          };
          var updateInfo = JSON.stringify(obj);
          client.send(updateInfo);
        });

        const contract = new ethers.Contract(tokenOut, ERC20_ABI, account);
        //We buy x amount of the new token for our wbnb
        amountIn = await contract.balanceOf(data.recipient);
        var decimal = await contract.decimals();
        if (amountIn < 1) return;
        amounts = await router.getAmountsOut(amountIn, [tokenOut, tokenIn]);
        //Our execution price will be a bit different, we need some flexbility
        amountOutMin = amounts[1].sub(
          amounts[1].mul(`${data.Slippage}`).div(100)
        );

        // check if the specific token already approves, then approve that token if not.
        let amount = await contract.allowance(
          data.recipient,
          data.chainId === 1 ? data.Urouter : data.Prouter
        );
        if (
          amount <
          115792089237316195423570985008687907853269984665640564039457584007913129639935
        ) {
          await contract.approve(
            data.chainId === 1 ? data.Urouter : data.Prouter,
            ethers.BigNumber.from(
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            ),
            { gasLimit: 100000, gasPrice: 5e9 }
          );
          console.log(tokenIn, " Approved \n");
        }

        price = amountOutMin / Math.pow(10, 18);
        console.log(chalk.green("Amount: ", price.toString()));
        fs.appendFile(
          "log.txt",
          new Date().toISOString() +
            ": Preparing to sell token " +
            tokenIn +
            " " +
            amountIn +
            " " +
            tokenOut +
            " " +
            amountOutMin +
            "\n",
          function (err) {
            if (err) throw err;
          }
        );

        if (true /*price > sellPrice*/) {
          console.log(
            chalk.green.inverse(`\nSell tokens: \n`) +
              `================= ${tokenIn} ===============`
          );
          console.log(chalk.yellow(`decimals: ${decimal}`));
          console.log(chalk.yellow(`price: ${price}`));
          // console.log(chalk.yellow(`sellPrice: ${sellPrice}`))
          console.log("");

          // sell the token via pancakeswap v2 router
          const tx_sell = await router
            .swapExactTokensForETHSupportingFeeOnTransferTokens(
              amountIn,
              0,
              [tokenOut, tokenIn],
              data.recipient,
              Date.now() + 1000 * 60 * 10, //10 minutes
              {
                gasLimit: data.gasLimit,
                gasPrice: ethers.utils.parseUnits(`10`, "gwei"),
              }
            )
            .catch((err) => {
              console.log("transaction failed...");
              isSell = false;
            });

          receipt = null;
          while (receipt === null) {
            try {
              receipt = await provider.getTransactionReceipt(tx_sell.hash);
            } catch (e) {
              console.log(e);
            }
          }
          console.log("Token is sold successfully...");
          var aWss = wss.getWss("/");
          aWss.clients.forEach(function (client) {
            var obj = {
              token: tokenIn,
              action: "Sell",
              price: price,
              transaction: tx_sell.hash,
            };
            var updateInfo = JSON.stringify(obj);
            client.send(updateInfo);
          });
          fs.appendFile(
            "log.txt",
            new Date().toISOString() +
              ": Sell token " +
              tokenIn +
              " " +
              amountIn +
              " " +
              tokenOut +
              " " +
              amountOutMin +
              "\n",
            function (err) {
              if (err) throw err;
            }
          );
          isBuy = false;
        }
      }
    } catch (err) {
      console.log("Something went wrong!!!", err);
      process.exit(0);
    }
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////

const data = {
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", //'0xc778417e063141139fce010982780140aa0cd5ab',    // WETH Address
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB Address
  Urouter: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router
  Prouter: "0x10ed43c718714eb63d5aa57b78b54704e256024e", // Pancakeswap V2 Router
};

/*****************************************************************************************************
 * Set Bot status consisting of wallet address, private key, token address, slippage, gas price, etc.
 * ***************************************************************************************************/
function setBotStatus(obj) {
  if (obj.botStatus) {
    botStatus = obj.botStatus;
    data.recipient = obj.walletAddr;
    data.privateKey = obj.privateKey;
    data.tokenAddress = obj.tokenAddress;
    data.AMOUNT_OF_WBNB = exponentialToDecimal(obj.inAmount);
    data.Slippage = obj.slippage;
    data.gasPrice = obj.gasPrice;
    data.gasLimit = obj.gasLimit;
    data.nodeURL = obj.nodeURL;
    data.limit = obj.limit;
    data.chainId = obj.chainId;
    data.blockKey = obj.blockKey;
    var n = data.limit * Math.pow(10, 18);
    var hexer = "0x".concat(n.toString(16));
    targetPrice = ethers.BigNumber.from(hexer);
    provider = new ethers.providers.JsonRpcProvider(data.nodeURL);
    wallet = new ethers.Wallet(data.privateKey);
    account = wallet.connect(provider);
    router = new ethers.Contract(
      data.chainId === 1 ? data.Urouter : data.Prouter,
      data.chainId !== 1
        ? [
            "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
            "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
            "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
            "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
            "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external",
          ]
        : uniswapV2ABI,
      account
    );
    targetToken = data.tokenAddress.toLowerCase().slice(2);
    WETHContract = new ethers.Contract(data.WETH, WETHABI, account);
  }
}

/*****************************************************************************************************
 * Convert exponential to Decimal. (e-3 - > 0.0001)
 * ***************************************************************************************************/
const exponentialToDecimal = (exponential) => {
  let decimal = exponential.toString().toLowerCase();
  if (decimal.includes("e+")) {
    const exponentialSplitted = decimal.split("e+");
    let postfix = "";
    for (
      let i = 0;
      i <
      +exponentialSplitted[1] -
        (exponentialSplitted[0].includes(".")
          ? exponentialSplitted[0].split(".")[1].length
          : 0);
      i++
    ) {
      postfix += "0";
    }
    const addCommas = (text) => {
      let j = 3;
      let textLength = text.length;
      while (j < textLength) {
        text = `${text.slice(0, textLength - j)},${text.slice(
          textLength - j,
          textLength
        )}`;
        textLength++;
        j += 3 + 1;
      }
      return text;
    };
    decimal = addCommas(exponentialSplitted[0].replace(".", "") + postfix);
  }
  if (decimal.toLowerCase().includes("e-")) {
    const exponentialSplitted = decimal.split("e-");
    let prefix = "0.";
    for (let i = 0; i < +exponentialSplitted[1] - 1; i++) {
      prefix += "0";
    }
    decimal = prefix + exponentialSplitted[0].replace(".", "");
  }
  return decimal;
};

/*****************************************************************************************************
 * Get the message from the frontend and analyze that, start mempool scan or stop.
 * ***************************************************************************************************/
app.ws("/connect", function (ws, req) {
  ws.on("message", async function (msg) {
    if (msg === "connectRequest") {
      var obj = { botStatus: botStatus };
      ws.send(JSON.stringify(obj));
    } else {
      var obj = JSON.parse(msg);
      setBotStatus(obj);
      botStatus = obj.botStatus;
      if (botStatus && !isStarted) {
        isStarted = true;
        scanMempool();
      }
    }
  });
});
/*****************************************************************************************************
 * Find the new liquidity Pair with specific token while scanning the mempool in real-time.
 * ***************************************************************************************************/
const scanMempool = async () => {
  const blocknative = new BlocknativeSDK({
    dappId: data.blockKey,
    networkId: data.chainId,
    transactionHandlers: [handleTransactionEvent],
    ws: WebSocket,
    onerror: (error) => {
      console.log(error);
    },
  });

  console.log(chalk.red(`\nStart detect Service Start ... `));

  sdkSetup(blocknative, data.chainId === 1 ? configurationU : configurationP);
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.get("/", function (req, res) {
  res.sendFile(path.join(__dirname, "/index.html"));
});
const PORT = 7000;

httpServer.listen(PORT, console.log(chalk.yellow(`Start Sandwich bot...`)));
