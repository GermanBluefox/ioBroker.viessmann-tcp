/* jshint -W097 */
/* jshint strict:false */
/* jslint node: true */

'use strict';

var utils = require(__dirname + '/lib/utils');
var xml2js = require('xml2js');
var net = require('net');
var command = require(__dirname + '/lib/command');
var unit = require(__dirname + '/lib/unit');
var parser = new xml2js.Parser(), fs = require('fs');
var oVito = null;
var fUnit = null;

var adapter = utils.adapter('viessmann-tcp');

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
        if (main.ViessmannConnected) {
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
        if (!main.ESPConnected) {
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
    main.main();
});

var main = { 

	client: 			new net.Socket(),
	ESPConnected: 		false,
	ViessmannInit:		false,
	ViessmannConnected: false,
	receiveAnswer:		false,
	commandArr: [],
	commandAssoc: [],
	idx: 0,

	calculateChecksum: function(v)
	{
		var nChecksum = 0;
		for(var i=2;i<v.length;i=i+2)
		{
			var dec = parseInt(v.charAt(i)+v.charAt(i+1), 16);
			nChecksum = nChecksum + dec;
		}
		
		return nChecksum.toString(16);
	},

	loop: function()
	{
		if (main.ESPConnected && main.ViessmannConnected && main.commandAssoc.length > 0)
		{				
			var cidx = main.commandAssoc[main.idx];
			if(cidx.length > 0)
			{
				// get Data from Viessmann
				if(main.commandArr[ cidx.toUpperCase() ].xmlObj.$['protocmd'] == 'getaddr')
				{
					adapter.log.debug('Address: ' + cidx.toUpperCase() + ' Try to get Value ' + main.commandArr[ cidx.toUpperCase() ].xmlObj.$['name']);
					
					var v   = "41050001" + main.commandArr[ cidx.toUpperCase() ].xmlObj.addr[0] + "0" + main.commandArr[ cidx.toUpperCase() ].xmlObj.len[0];						
					var hex =  v + main.calculateChecksum(v);
			
					main.sendRequest(hex);
					main.idx++;
				}
				// Maybe many more eg. setaddr?
				
			}
		}
	},
	
	setState: function(cmd)
	{
		adapter.getObject(adapter.namespace + '.' + cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0], function (err, obj) {
			if (!obj) {
				adapter.log.debug('Create new Object ' + adapter.namespace + '.' + cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0] + ', because not found in ioBroker.');
				var object = {
					_id: adapter.namespace + '.' + cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0],
					common: {
						name: cmd.xmlObj.description[0],
						role: cmd.xmlObj.$['protocmd'],
						type: 'number'
					},
					native: {},
					type: 'state'
				};

				adapter.setObject(cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0], object, function (err, obj) {
					adapter.setState(cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0], {val: cmd.value['Dec'], ack: true});
				});
			}
			else
			{
				adapter.log.debug('Address: ' + cmd.xmlObj.addr[0] + ' ' + adapter.namespace + '.' + cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0] + ' Object found, set Value to ' + cmd.value['Dec']);
				adapter.setState(cmd.xmlObj.$['name'] + '_' + cmd.xmlObj.addr[0], {val: cmd.value['Dec'], ack: true});
			}
		});
	},

	sendRequest: function(data)
	{
		if(data.length > 0)
		{
			var buf = Buffer.from(data, 'hex');
			
			main.client.write( buf );
		}
	},

	main: function() {
		adapter.config.host = adapter.config.host || '127.0.0.1';
		adapter.config.port = parseInt(adapter.config.port, 10) || 8888;
		adapter.config.refresh = parseInt(adapter.config.refresh, 10) || 60;
		
		fUnit = new unit({
			oVito: oVito
		});

		adapter.log.debug('Try to connect to Viessmann at: ' + adapter.config.host + ':' + adapter.config.port);

		// in this template all states changes inside the adapters namespace are subscribed
		adapter.subscribeStates('*');
		
		main.client.connect(adapter.config.port, adapter.config.host, function() {
			if (!main.ESPConnected) {
				adapter.log.debug('Connected');
				main.ESPConnected = true;
				adapter.setState('info.connection', true, false);
				
				// Set Viessmann back to default Serial Connection
				main.sendRequest('04');		
			}
		});
		
		main.client.on('data', function (data) {
			if (main.ESPConnected) 
			{
				if(main.receiveAnswer)
				{
					main.receiveAnswer = false;
					var answer = Buffer.from(data).toString('hex');
					
					var cmd = answer.charAt(8) + answer.charAt(9) + answer.charAt(10) + answer.charAt(11);
					if(cmd.length > 0)
					{
						if(main.commandArr[ cmd.toUpperCase() ] !== undefined)
						{
							adapter.log.debug('Address: ' + cmd + ' Receive: ' + answer);
								
							main.commandArr[ cmd.toUpperCase() ].on('handleAnswerReady', function ()
							{
								adapter.log.debug('Address: ' + cmd + ' call handleAnswerReady');
								
								main.setState(main.commandArr[ cmd.toUpperCase() ]);
								
								adapter.log.debug(main.idx-1 + ' -  ' + main.commandAssoc.length);
								if(main.idx >= main.commandAssoc.length)
								{
									main.idx = 0;
									adapter.log.debug('Restart to get new values in ' + adapter.config.refresh + ' seconds.');
									setTimeout(main.loop, adapter.config.refresh * 1000);
								}
								else
								{
									main.loop();				
								}
							});
							
							main.commandArr[ cmd.toUpperCase() ].handleAnswer(answer);
						}
						else
						{
							adapter.log.debug('Address: ' + cmd + ' Array not found.');
							adapter.log.debug(JSON.stringify(main.commandArr));
						}
					}
					else
					{
						adapter.log.debug('No Address found in answer: ' + answer);
					}
				}
				if(data == '\x05') // initialer Aufruf
				{
					adapter.log.debug('Viessmann Serial Connect');
					main.sendRequest('160000');
					main.ViessmannInit = true;
					
					for (var c in oVito.commands[0].command)
					{
						main.commandArr[ oVito.commands[0].command[c].addr[0].toUpperCase() ] = new command({fUnit, adapter});
						main.commandArr[ oVito.commands[0].command[c].addr[0].toUpperCase() ].init(oVito, oVito.commands[0].command[c].addr[0]);
						main.commandAssoc.push(oVito.commands[0].command[c].addr[0].toUpperCase());
					}
				}
				if(data == '\x06') // Anfrage ok
				{
					if(main.ViessmannInit && !main.ViessmannConnected)
					{
						main.ViessmannConnected = true;
						main.loop();
					}
					main.receiveAnswer = true;
				}
				if(data == '\x15') // Fehler in der Anfrage
				{
					adapter.log.debug('Fehler in der Anfrage - Viessmann konnte Anfrage nicht verarbeiten.');
				}
			}
		});
		
		main.client.on('error', function (data) {
			adapter.log.debug('Fehler beim Verbindungsaufbau: ' + data);
		});
		
		main.client.on('end', function () {
			if (ESPConnected) {
				adapter.log.debug('Disconnected');
				main.connected = false;
				adapter.setState('info.connection', false, true);
			}
		});
		
		main.client.on('close', function () {
			if (ESPConnected) {
				main.client.write('\x04');
				adapter.log.debug('Disconnected');
				main.ESPConnected = false;
				main.ViessmannConnected = false;
				adapter.setState('info.connection', false, true);
			}
		});
	}
}
