import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Explicit allowlist: the download contains extension code only, never local
// credentials, browser data, source maps or repository configuration.
export const extensionFiles=['manifest.json','worker.js','recorder.js','post-submit.js','result-verification.js','polling-schedule.js','extension-update.js','adapter.js','publication-policy.js','form-actions.js','automation-tabs.js','marketplace-contract.js','group-contract.js','group-discovery.js','pairing.js','supplier-capture.js','supplier-site-domain.js','supplier-capture-main.js','supplier-capture-page.js','supplier-capture-ui.js','shared/product-extract.js','connect.html','connect.js','connect.css'];
export const updaterDistributionFiles=[
  ['Instalar-RivaStock-Actualizador.cmd','scripts/install-rivastock-extension-updater.cmd'],
  ['install-rivastock-extension-updater.ps1','scripts/install-rivastock-extension-updater.ps1'],
  ['rivastock-extension-updater.ps1','scripts/rivastock-extension-updater.ps1'],
  ['Desinstalar-RivaStock-Actualizador.cmd','scripts/uninstall-rivastock-extension-updater.cmd'],
  ['uninstall-rivastock-extension-updater.ps1','scripts/uninstall-rivastock-extension-updater.ps1'],
];
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) {
    crc^=byte;
    for(let bit=0;bit<8;bit++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function storedZip(files) {
  const entries=[];const directory=[];let offset=0;
  for(const {name:file,data} of files) {
    const name=Buffer.from(file);
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
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...entries,central,end]);
}
export function extensionArchive(root) {
  const files=extensionFiles.map(file=>({
    name:file,
    data:readFileSync(file.startsWith('shared/')?resolve(root,'extensions',file):resolve(root,'extensions/facebook',file)),
  }));
  return storedZip(files);
}
export function updaterDistributionArchive(root) {
  return storedZip(updaterDistributionFiles.map(([name,source])=>({name,data:readFileSync(resolve(root,source))})));
}
export function extensionReleaseManifest(root, archive=extensionArchive(root)) {
  const manifest=JSON.parse(readFileSync(resolve(root,'extensions/facebook/manifest.json'),'utf8'));
  return {
    version:manifest.version,
    url:'https://rivastock.vercel.app/downloads/rivastock-facebook.zip',
    sha256:createHash('sha256').update(archive).digest('hex'),
    files:extensionFiles,
  };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  mkdirSync(resolve(root,'public/downloads'),{recursive:true});
  const archive=extensionArchive(root);
  writeFileSync(resolve(root,'public/downloads/rivastock-facebook.zip'),archive);
  const manifest=JSON.parse(readFileSync(resolve(root,'extensions/facebook/manifest.json'),'utf8'));
  const sha256=createHash('sha256').update(archive).digest('hex');
  writeFileSync(resolve(root,'public/downloads/rivastock-facebook-version.json'),JSON.stringify({version:manifest.version,protocol:2,sha256,files:extensionFiles},null,2)+'\n');
  writeFileSync(resolve(root,'public/downloads/extension-version.json'),JSON.stringify(extensionReleaseManifest(root,archive),null,2)+'\n');
  writeFileSync(resolve(root,'public/downloads/rivastock-extension-updater.zip'),updaterDistributionArchive(root));
}
