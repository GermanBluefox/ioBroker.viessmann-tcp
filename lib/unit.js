function unit(options)
{
    if (!(this instanceof unit)) return new unit();
    
	var that = this;

	this.oVito = options.oVito;

	this.getUnit = function(unit)
	{
		for (var z in this.oVito.units[0].unit)
		{
			if(unit == this.oVito.units[0].unit[z]['abbrev'][0])
			{
				return this.oVito.units[0].unit[z];
			}
		}
		
		return false;
	};
	
	return this;
}



module.exports = unit;