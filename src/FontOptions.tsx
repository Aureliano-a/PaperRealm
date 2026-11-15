import { fonts } from './types';
import { tr } from './i18n';

// Repeated fonts intentionally appear under each language they support.
const groups: [string, string[]][] = [
  ['简体中文', ['readestWenKaiScreen','readestNotoSC','readestSourceHan','QingKai','QingKaiElegant','song','sans','soft','night','localMiSans','localHuiwen','localKingHwa','localFangSong','localKaiTi','localSimHei']],
  ['English · 英语', ['readestLiterata','readestBitter','readestMerriweather','readestNotoSans','readestOpenSans','readestRoboto','readestRobotoSlab','readestVollkorn','readestPTSans','readestPTSerif','readestPTMono','readestFiraCode']],
  ['日本語 · 日语', ['readestNotoJP']],
  ['Español · 西班牙语', ['readestNotoSans','readestLiterata','readestMerriweather','readestRoboto']],
  ['Русский · 俄语', ['readestPTSans','readestPTSerif','readestPTMono','readestNotoSans','readestRoboto']],
  ['通用', ['system','custom']],
];
export function FontOptions() {
  return <>{groups.map(([label, keys]) => <optgroup key={label} label={tr(label)}>
    {keys.filter(key => fonts[key]).map(key => <option key={key} value={key}>{tr(fonts[key].name)}</option>)}
  </optgroup>)}</>;
}
