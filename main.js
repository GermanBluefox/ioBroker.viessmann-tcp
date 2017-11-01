/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */

'use strict';

var utils = require(__dirname + '/lib/utils');
var xml2js = require('xml2js');
var net = require('net');

var adapter = utils.adapter('viessmann-tcp');

var client = new net.Socket();
var ESPConnected = false;
var ViessmannConnected = false;
var WifiBusy = false;
var lastRequest = null;
var receiveAnswer = false;
var answer = null;
var oVito = null;
var parser = new xml2js.Parser(), fs = require('fs');

// Datei einlesen
fs.readFile(__dirname + '/vito.xml', function (err, data) {
    parser.parseString(data, function (err, result) {
        oVito = result.vito;
    });
});

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.setState('info.connection', false, true);
        if (ViessmannConnected) {
			client.close();
        }
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        if (!ESPConnected) {
            adapter.log.warn('Cannot send command to "' + id + '", because not connected');
            return;
        }
    }
});

// Some message was sent to adapter instance over message box. Used by email, pushover, text2speech, ...
adapter.on('message', function (obj) {
    if (typeof obj === 'object' && obj.message) {
        if (obj.command === 'send') {
            // e.g. send email or pushover or whatever
            console.log('send command');

            // Send response in callback if required
            if (obj.callback) adapter.sendTo(obj.from, obj.command, 'Message received', obj.callback);
        }
    }
});

// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', function () {	
    main();
});

function loop()
{
	if (ESPConnected && ViessmannConnected && !WifiBusy) {
		//sendRequest('4105000155250282');
		getValue('getTempA');
	}
}
function getValue(name)
{
	for (var z in oVito.commands[0].command)
	{
		if(name == oVito.commands[0].command[z].$['name'] && oVito.commands[0].command[z].$['protocmd'] == 'getaddr')
		{
			var addr = oVito.commands[0].command[0].addr[0];
			var len  = oVito.commands[0].command[0].len[0];
			adapter.log.debug('Try to get Value from Adress ' + addr + ' (' + name + ')');
			
			var hex  = "41050001" + addr + "0" + len + "82";
		}
	}
	
	sendRequest(hex);
}

function sendRequest(data)
{
	if(data.length > 0)
	{
		var buf = Buffer.from(data, 'hex');
				
        //adapter.log.debug('Request: '+ data + ' buf: ' + buf);
		
		WifiBusy = true;
		lastRequest = buf;
		client.write( buf );
		
		setTimeout(function() {
			//Reset WifiBusy, if there where no data incoming
			if(WifiBusy)
			{
				WifiBusy = false;
				adapter.log.debug('Reset WifiBusy, because there are no Data incoming');
			}
		}, 1000);
	}
}

function handleAnswer()
{
	adapter.log.debug('Antwort: ' + answer);
	
	var bytelength = answer.charAt(12) + answer.charAt(13);
	if(bytelength > 0)
	{
		var value = '';
		for(var i=14;i<14+(bytelength*2);i++)
		{
			value = value + answer.charAt(i);
		}
		adapter.log.debug('Value: ' + value);
		adapter.log.debug('Value: ' + parseInt(value.charAt(0)+value.charAt(1), 16) / 10);
	}
}

function main() {
    adapter.config.host = adapter.config.host || '127.0.0.1';
    adapter.config.port = parseInt(adapter.config.port, 10) || 8888;
    adapter.config.refresh = parseInt(adapter.config.refresh, 10) || 60;

    adapter.log.debug('Try to connect to Viessmann at: ' + adapter.config.host + ':' + adapter.config.port);

    // in this template all states changes inside the adapters namespace are subscribed
    adapter.subscribeStates('*');
	
	client.connect(adapter.config.port, adapter.config.host, function() {
		if (!ESPConnected && !WifiBusy) {
            adapter.log.debug('Connected');
            ESPConnected = true;
			adapter.setState('info.connection', true, false);
			
			// Set Viessmann back to default Serial Connection
			sendRequest('04');		
        }
	});
	
	client.on('data', function (data) {
		if (ESPConnected) {
			if(receiveAnswer)
			{
				answer = Buffer.from(data).toString('hex');
				
				handleAnswer();
				receiveAnswer = false;
				WifiBusy = false;				
			}
			if(data == '\x05') // initialer Aufruf
			{
				adapter.log.debug('Viessmann Serial Connect');
				sendRequest('160000');
				ViessmannConnected = true;
				setInterval(loop, adapter.config.refresh * 1000);
			}
			if(data == '\x06') // Anfrage ok
			{
				receiveAnswer = true;
			}
			if(data == '\x15') // Fehler in der Anfrage
			{
				adapter.log.debug('Fehler in der Anfrage - Viessmann konnte Anfrage nicht verarbeiten.');
			}
		}
    });
	
    client.on('error', function (data) {
        adapter.log.debug('Fehler beim Verbindungsaufbau: ' + data);
    });
	
    client.on('end', function () {
        if (ESPConnected) {
            adapter.log.debug('Disconnected');
            connected = false;
            adapter.setState('info.connection', false, true);
        }
    });
	
    client.on('close', function () {
        if (ESPConnected) {
			client.write('\x04');
            adapter.log.debug('Disconnected');
            ESPConnected = false;
			ViessmannConnected = false;
            adapter.setState('info.connection', false, true);
        }
    });
}
