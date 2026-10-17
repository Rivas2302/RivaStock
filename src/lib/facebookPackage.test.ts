import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';import {extensionArchive,extensionFiles} from '../../scripts/package-facebook-extension.mjs';
it('no extension source file contains carriage returns',()=>{
 for(const name of extensionFiles)expect(readFileSync('extensions/facebook/'+name).includes(13),`${name} contains \\r`).toBe(false);
});
it('packages exactly the allowlisted source bytes with one manifest and no private files',()=>{
 const bytes=extensionArchive(process.cwd());const names:string[]=[];let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);const name=bytes.subarray(offset+30,offset+30+length).toString();names.push(name);expect(bytes.readUInt16LE(offset+8)).toBe(0);const start=offset+30+length+extra;expect(bytes.subarray(start,start+size).equals(readFileSync('extensions/facebook/'+name))).toBe(true);offset=start+size;}
 expect(names).toEqual(extensionFiles);expect(names.filter(n=>n==='manifest.json')).toHaveLength(1);expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
 const manifest=JSON.parse(readFileSync('extensions/facebook/manifest.json','utf8'));expect(manifest.version).toBe('0.5.4');expect(manifest.permissions).toEqual(['storage','alarms','scripting']);
});
