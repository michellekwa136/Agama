const Promise = require('bluebird');
const reverse = require('buffer-reverse');
const crypto = require('crypto');
const _sha256 = (data) => {
  return crypto.createHash('sha256').update(data).digest();
};

module.exports = (shepherd) => {
  // get merkle root
  shepherd.getMerkleRoot = (txid, proof, pos) => {
    let hash = txid;
    let serialized;

    shepherd.log(`getMerkleRoot txid ${txid}`, 'spv.merkle');
    shepherd.log(`getMerkleRoot pos ${pos}`, 'spv.merkle');
    shepherd.log('getMerkleRoot proof', 'spv.merkle');
    shepherd.log(`getMerkleRoot ${proof}`, 'spv.merkle');

    for (i = 0; i < proof.length; i++) {
      const _hashBuff = new Buffer(hash, 'hex');
      const _proofBuff = new Buffer(proof[i], 'hex');

      if ((pos & 1) == 0) {
        serialized = Buffer.concat([reverse(_hashBuff), reverse(_proofBuff)]);
      } else {
        serialized = Buffer.concat([reverse(_proofBuff), reverse(_hashBuff)]);
      }

      hash = reverse(_sha256(_sha256(serialized))).toString('hex');
      pos /= 2;
    }

    return hash;
  }

  shepherd.verifyMerkle = (txid, height, serverList, mainServer, network) => {
    // select random server
    const getRandomIntInclusive = (min, max) => {
      min = Math.ceil(min);
      max = Math.floor(max);

      return Math.floor(Math.random() * (max - min + 1)) + min; // the maximum is inclusive and the minimum is inclusive
    }

    const _rnd = getRandomIntInclusive(0, serverList.length - 1);
    const randomServer = serverList[_rnd];
    const _randomServer = randomServer.split(':');
    const _mainServer = mainServer.split(':');

    //let ecl = new shepherd.electrumJSCore(_mainServer[1], _mainServer[0], _mainServer[2]); // tcp or tls
    let ecl = shepherd.ecl(network, { ip: _mainServer[0], port: _mainServer[1], proto: _mainServer[2] });

    return new Promise((resolve, reject) => {
      shepherd.log(`main server: ${mainServer}`, 'spv.merkle');
      shepherd.log(`verification server: ${randomServer}`, 'spv.merkle');

      ecl.connect();
      ecl.blockchainTransactionGetMerkle(txid, height)
      .then((merkleData) => {
        if (merkleData &&
            merkleData.merkle &&
            merkleData.pos) {
          shepherd.log('electrum getmerkle =>', 'spv.merkle');
          shepherd.log(merkleData, 'spv.merkle');
          ecl.close();

          const _res = shepherd.getMerkleRoot(txid, merkleData.merkle, merkleData.pos);
          shepherd.log(_res, 'spv.merkle');

          ecl = shepherd.ecl(network, { ip: _randomServer[0], port: _randomServer[1], proto: _randomServer[2] });
          // ecl = new shepherd.electrumJSCore(_randomServer[1], _randomServer[0], randomServer[2]);
          ecl.connect();

          shepherd.getBlockHeader(height, network, ecl)
          .then((blockInfo) => {
            if (blockInfo &&
                blockInfo.merkle_root) {
              ecl.close();
              shepherd.log('blockinfo =>', 'spv.merkle');
              shepherd.log(blockInfo, 'spv.merkle');
              shepherd.log(blockInfo.merkle_root, 'spv.merkle');

              if (blockInfo &&
                  blockInfo.merkle_root) {
                if (_res === blockInfo.merkle_root) {
                  resolve(true);
                } else {
                  resolve(false);
                }
              } else {
                ecl.close();
                resolve(shepherd.CONNECTION_ERROR_OR_INCOMPLETE_DATA);
              }
            } else {
              ecl.close();
              resolve(shepherd.CONNECTION_ERROR_OR_INCOMPLETE_DATA);
            }
          });
        } else {
          ecl.close();
          resolve(shepherd.CONNECTION_ERROR_OR_INCOMPLETE_DATA);
        }
      });
    });
  }

  shepherd.verifyMerkleByCoin = (coin, txid, height) => {
    const _serverList = shepherd.electrumCoins[coin].serverList;

    shepherd.log('verifyMerkleByCoin', 'spv.merkle');
    shepherd.log(shepherd.electrumCoins[coin].server, 'spv.merkle');
    shepherd.log(shepherd.electrumCoins[coin].serverList, 'spv.merkle');

    return new Promise((resolve, reject) => {
      if (_serverList !== 'none') {
        let _filteredServerList = [];

        for (let i = 0; i < _serverList.length; i++) {
          if (_serverList[i] !== shepherd.electrumCoins[coin].server.ip + ':' + shepherd.electrumCoins[coin].server.port + ':' + shepherd.electrumCoins[coin].server.proto) {
            _filteredServerList.push(_serverList[i]);
          }
        }

        shepherd.verifyMerkle(
          txid,
          height,
          _filteredServerList,
          shepherd.electrumCoins[coin].server.ip + ':' + shepherd.electrumCoins[coin].server.port + ':' + shepherd.electrumCoins[coin.toLowerCase() === 'kmd' || coin === 'komodo' ? 'kmd' : coin].server.proto,
          coin
        )
        .then((proof) => {
          resolve(proof);
        });
      } else {
        resolve(false);
      }
    });
  }

  shepherd.get('/electrum/merkle/verify', (req, res, next) => {
    if (shepherd.checkToken(req.query.token)) {
      const _coin = req.query.coin;
      const _txid = req.query.txid;
      const _height = req.query.height;

      shepherd.verifyMerkleByCoin(_coin, _txid, _height)
      .then((verifyMerkleRes) => {
        const retObj = {
          msg: 'success',
          result: {
            merkleProof: verifyMerkleRes,
          },
        };

        res.end(JSON.stringify(retObj));
      });
    } else {
      const retObj = {
        msg: 'error',
        result: 'unauthorized access',
      };

      res.end(JSON.stringify(retObj));
    }
  });

  return shepherd;
};