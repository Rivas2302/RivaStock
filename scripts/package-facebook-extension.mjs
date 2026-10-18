import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicit allowlist: the download contains extension code only, never local
// credentials, browser data, source maps or repository configuration.
export const extensionFiles=['manifest.json','worker.js','adapter.js','form-actions.js','automation-tabs.js','marketplace-contract.js','group-contract.js','group-discovery.js','pairing.js','connect.html','connect.js','connect.css'];
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) {
    crc^=byte;
    for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
export function extensionArchive(root) {
  const entries=[];const directory=[];let offset=0;
  for(const file of extensionFiles) {
    const name=Buffer.from(file);const data=readFileSync(resolve(root,'extensions/facebook',file));
    const crc=crc32(data);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
    local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);
    local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);
    central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
    central.writeUInt32LE(offset,42);
    entries.push(local,name,data);directory.push(central,name);
    offset+=local.length+name.length+data.length;
  }
  const central=Buffer.concat(directory);const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(extensionFiles.length,8);end.writeUInt16LE(extensionFiles.length,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries,central,end]);
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  mkdirSync(resolve(root,'public/downloads'),{recursive:true});
  const archive=extensionArchive(root);
  writeFileSync(resolve(root,'public/downloads/rivastock-facebook.zip'),archive);
  const manifest=JSON.parse(readFileSync(resolve(root,'extensions/facebook/manifest.json'),'utf8'));
  writeFileSync(resolve(root,'public/downloads/rivastock-facebook-version.json'),JSON.stringify({version:manifest.version,protocol:2,sha256:createHash('sha256').update(archive).digest('hex'),files:extensionFiles},null,2)+'\n');
}
