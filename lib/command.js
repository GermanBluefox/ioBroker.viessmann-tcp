var events  = require('events');
var util    = require('util');

function command(options)
{
    if (!(this instanceof command)) return new command();
    
	var that = this;

	this.xmlObj = [];
	this.value = {
		Hex: '',
		Dec: ''
	};
	this.fUnit = options.fUnit;
	this.adapter = options.adapter;
	
	this.init = function(oVito, addr)
	{
		for (var x in oVito.commands[0].command)
		{
			if(addr == oVito.commands[0].command[x].addr[0])
			{
				this.xmlObj = oVito.commands[0].command[x];
			}
		}
	};
	
	this.handleAnswer = function(answer)
	{		
		var bytelength = parseInt(answer.charAt(12) + answer.charAt(13));
		
		if(bytelength > 0)
		{
		
			this.adapter.log.debug('Address: ' + this.xmlObj.addr[0] + ' Byte Length: ' + bytelength);
			var valueHex = '';
			for(var i=14;i<14+(bytelength*2);i++)
			{
				valueHex = valueHex + answer.charAt(i);
			}
			
			this.value['Hex'] = valueHex;
			
			var oUnit = this.fUnit.getUnit(this.xmlObj.unit[0]);
			
			if(!oUnit.calc)
			{
				this.value['Dec'] = parseInt(this.value['Hex'].charAt(0)+this.value['Hex'].charAt(1), 16);
			}
			else
			{
				var get  = oUnit.calc[0].$['get'];
				this.value['Dec'] = eval(new String(get.replace("V", parseInt(this.value['Hex'].charAt(0)+this.value['Hex'].charAt(1), 16))).toString());
			}
			
			that.emit('handleAnswerReady');
		}
	};
	
	return this;
}

util.inherits(command, events.EventEmitter);

module.exports = command;