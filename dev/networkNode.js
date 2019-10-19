const express = require('express')
const app = express()
const bodyParser = require('body-parser'); //convert req in json
const Blockchain = require('./blockchain');
const uuid = require('uuid/v1');
const port = process.argv[2];
const rp = require('request-promise');
const cors = require('cors')
const zerosString = '0000';
const numberOfZeros = zerosString.length;
const nodeAddress = uuid().split('-').join('');

const medicalChain = new Blockchain();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}))
app.use(cors())


app.get('/blockchain', function (req, res) {
	res.send(medicalChain);
});


app.post('/transaction', function (req, res) {
	const newTransaction = req.body.newTransaction;
	const blockIndex = medicalChain.addTransactionToPendingTransactions(newTransaction);
	res.json({note: `Transaction will be added in block ${blockIndex}.`});
});

app.post('/transactionMoney/broadcast', function (req, res) {
	const newTransaction = medicalChain.createNewTransactionMoney(req.body.amount, req.body.sender, req.body.recipient);
	medicalChain.addTransactionToPendingTransactions(newTransaction);

	const requestPromises = [];
	medicalChain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + "/transaction",
			method: 'POST',
			body: {newTransaction: newTransaction},
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(data => {
		res.json({note: 'Transaction created and broadcast successfully'});
	});
});

app.post('/transaction/broadcast', (req, res) => {
	const password = req.body.password;
	const carId = req.body.carId;
	if(!medicalChain.isPasswordValid(carId, password)){
		res.json({ note: 'Password incorrect' });
	} else {
		const newTransaction = medicalChain.createNewTransaction(req.body.meter, req.body.carId, password);
		medicalChain.addTransactionToPendingTransactions(newTransaction);

		const requestPromises = [];
		medicalChain.networkNodes.forEach(networkNodeUrl =>{
			const requestOptions = {
				uri: networkNodeUrl + "/transaction",
				method: 'POST',
				body: { newTransaction: newTransaction},
				json: true
			};

			requestPromises.push(rp(requestOptions));
		});

		Promise.all(requestPromises)
		.then(data => {
			res.json({ note: 'Transaction created and broadcast successfully' });
		});
	}
});

app.get('/mine', function (req, res) {
	console.log("mine chamado");
	const lastBlock = medicalChain.getLastBlock();
	const previousBlockHash = lastBlock['hash'];
	const currentBlockData = {
        transactions: medicalChain.pendingTransactions.slice(),//passando por copia
        index: lastBlock['index'] + 1
    };
    const nonce = medicalChain.proofOfWork(previousBlockHash, currentBlockData);
    if(nonce == -1) {
    	const requestOptions = {
    		uri: medicalChain.currentNodeUrl + '/consensus',
    		method: 'GET',
    		json: true
    	}
    	console.log('Chamando consensus pq outro no minerou primeiro');
    	rp(requestOptions);
    }
    else {
    	const blockHash = medicalChain.hashBlock(previousBlockHash, currentBlockData, nonce);
    	const newBlock = medicalChain.createNewBlock(nonce, previousBlockHash, blockHash, currentBlockData['transactions']);

    	const requestPromises = [];
    	medicalChain.networkNodes.forEach(networkNodeUrl => {
    		const requestOptions = {
    			uri: networkNodeUrl + "/receive-new-block",
    			method: "POST",
    			body: {newBlock: newBlock},
    			json: true
    		};
    		requestPromises.push(rp(requestOptions));
    	});
    	Promise.all(requestPromises)
    	.then(data => {
    		const requestOptions = {
    			uri: medicalChain.currentNodeUrl + '/transactionMoney/broadcast',
    			method: "POST",
    			body: {
    				amount: 12.5,
    				sender: "00",
    				recipient: nodeAddress
    			},
    			json: true
    		};
    		return rp(requestOptions);
    	})
    	.then(data => {
    		res.json({
    			note: "New block mined & broadcast successfully",
    			block: newBlock
    		});
    	});
    }
});

app.post("/receive-new-block", function (req, res) {
	const newBlock = req.body.newBlock;
	const lastBlock = medicalChain.getLastBlock();
	const correctHash = lastBlock.hash === newBlock.previousBlockHash;
	const correctIndex = lastBlock['index'] + 1 === newBlock['index'];
	const blockHash = medicalChain.hashBlock(lastBlock['hash'], {
		transactions: newBlock['transactions'],
		index: newBlock['index']
	}, newBlock['nonce']);
	const correctNonce = blockHash.substring(0, numberOfZeros) === zerosString;

	if (correctIndex && correctHash && correctNonce){
		console.log('setando already block mined');
		medicalChain.setAlreadyBlockMined();
		medicalChain.chain.push(newBlock);
		medicalChain.removeMinedTransactions(newBlock['transactions']);
		res.json({
			note: 'New block received and accepted.',
			newBlock: newBlock
		});
	} else {
		console.log('bloco rejeitado');
		res.json({
			note: 'New block rejected.',
			newBlock: newBlock
		});
	}

});

// register a node and broadcast it the network, adiciona o nó e chama register node para todos os nós da rede,
// fazendo com que todos os nós adicionem o novo nó. Depois disso, adiciona todos os nós para o novo nó inserido, através do register-nodes-bulk
app.post('/register-and-broadcast-node', function (req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	if (medicalChain.networkNodes.indexOf(newNodeUrl) == -1)
		medicalChain.networkNodes.push(newNodeUrl);

	const regNodesPromises = [];
	medicalChain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/register-node',
			method: 'POST',
			body: {newNodeUrl: newNodeUrl},
			json: true
		};

		regNodesPromises.push(rp(requestOptions));

	});

	Promise.all(regNodesPromises)
	.then(data => {
		const bulkRegisterOptions = {
			uri: newNodeUrl + "/register-nodes-bulk",
			method: 'POST',
			body: {allNetworkNodes: [...medicalChain.networkNodes, medicalChain.currentNodeUrl]},
			json: true
		};
		return rp(bulkRegisterOptions);
	})
	.then(data => {
		res.json({node: 'New node registred with network successfully.'});
	})

});

// register a node with the network
app.post('/register-node', function (req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	const nodeNotAlreadyPresent = medicalChain.networkNodes.indexOf(newNodeUrl) == -1;
	const notCurrentNode = medicalChain.currentNodeUrl != newNodeUrl;

	if (nodeNotAlreadyPresent && notCurrentNode)
		medicalChain.networkNodes.push(newNodeUrl);
	res.json({node: 'New node registered successfully.'});
});

//chamado após o nó ser inserido na rede, para que o novo no tenha todos os nós da rede
app.post('/register-nodes-bulk', function (req, res) {
	const allNetworkNodes = req.body.allNetworkNodes;
	allNetworkNodes.forEach(networkNodeUrl => {
		const nodeNotAlreadyPresent = medicalChain.networkNodes.indexOf(networkNodeUrl) == -1;
		const notCurrentNode = medicalChain.currentNodeUrl != networkNodeUrl;
		if (nodeNotAlreadyPresent && notCurrentNode)
			medicalChain.networkNodes.push(networkNodeUrl);
	});
	const consensusRequest = {
		uri: medicalChain.currentNodeUrl + "/consensus",
		method: 'GET',
		json: true
	};
	rp(consensusRequest);

	res.json({note: 'Bulk registration successfully.'});
});

app.get('/consensus', function (req, res) {
	const requestPromises = [];
	medicalChain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/blockchain',
			method: 'GET',
			json: true
		};
		requestPromises.push(rp(requestOptions));
	});

	Promise.all(requestPromises)
	.then(blockchains => {
		const currentChainLength = medicalChain.chain.length;
		let maxChainLength = currentChainLength;
		let newLongestChain = null;
		let newPendingTransactions = null;

		blockchains.forEach(blockchain => {
			if (blockchain.chain.length > maxChainLength) {
				maxChainLength = blockchain.chain.length;
				newLongestChain = blockchain.chain;
				newPendingTransactions = blockchain.pendingTransactions;
			}
		});

		if (!newLongestChain || (newLongestChain && !medicalChain.chainIsValid(newLongestChain))) {
			res.json({
				note: 'Current chain has not been replaced',
				chain: medicalChain.chain
			});
		} else if (newLongestChain && medicalChain.chainIsValid(newLongestChain)) {
			medicalChain.chain = newLongestChain;
			medicalChain.pendingTransactions = newPendingTransactions;
			res.json({
				note: 'This chain has been replaced',
				chain: medicalChain.chain
			});
		}
	});
});

app.get('/block/:blockHash', (req, res) => { //localhost:3001/block/asdowidonaioda
	const blockHash = req.params.blockHash;
	const correctBlock = medicalChain.getBlock(blockHash);
	res.json({
		block: correctBlock
	});
});

app.get('/transaction/:transactionId', (req, res) => {
	const transactionId = req.params.transactionId;
	const transactionData = medicalChain.getTransaction(transactionId);
	res.json({
		transaction: transactionData.transaction,
		block: transactionData.block
	});
});

app.get('/address/:address', (req, res) => {
	const address = req.params.address;
	const addressData = medicalChain.getAddressData(address);
	res.json({
		addressData: addressData
	});
});

app.get('/carId/:carId', (req, res) => {
	const carId = req.params.carId;
	const carIdData = medicalChain.getDataByCarId(carId);
	res.json({
		carIdData: carIdData
	});
});


app.get('/block-explorer', (req, res) => {
	res.sendFile('./block-explorer/index.html', {root: __dirname});
});

app.get('/mineAll', (req,res) => {
	console.log('mineAll');
	const requestPromises = [];
	medicalChain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/mine',
			method: 'GET',
			json: true
		};
		requestPromises.push(rp(requestOptions));
	});
	const requestOptions = {
		uri: medicalChain.currentNodeUrl + '/mine',
		method: 'GET',
		json: true
	};
	requestPromises.push(rp(requestOptions));
	Promise.all(requestPromises)
	.then(data => {
		res.json({node: 'Mineirado com sucesso'});
	})
});

function verify(){
	const requests = [];
	const nodesOk = [];
	medicalChain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/nodeOn',
			method: 'POST',
			json: true
		};
		requests.push(rp(requestOptions)
			.then(response => {
				const url = response.url;
				nodesOk.push(url);
			})
			.catch(err => {
				console.log('erro')
			}));
	});
	Promise.all(requests)
	.then(() => {
		medicalChain.networkNodes = nodesOk;
		console.log(nodesOk);
	})
}

app.post('/nodeOn', (req,res) => {
	res.json({url: medicalChain.currentNodeUrl})
});

app.listen(port, function () {
	console.log(`Listening on port ${port}...`);
});