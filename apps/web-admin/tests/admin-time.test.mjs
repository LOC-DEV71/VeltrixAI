import {test} from 'node:test';
import assert from 'node:assert/strict';
import {absoluteAdminTime,relativeAdminTime} from '../src/adminTime.ts';

const now=Date.parse('2026-10-04T00:00:00Z');
test('relative times cover exact minute/hour/day/month/year boundaries',()=>{
  for(const [seconds,expected] of [[0,'Vừa xong'],[59,'Vừa xong'],[60,'1 phút trước'],[3599,'59 phút trước'],[3600,'1 giờ trước'],[86399,'23 giờ trước'],[86400,'1 ngày trước'],[29*86400,'29 ngày trước'],[30*86400,'1 tháng trước'],[364*86400,'12 tháng trước'],[365*86400,'1 năm trước'],[2*365*86400,'2 năm trước']]){
    assert.equal(relativeAdminTime(new Date(now-seconds*1000).toISOString(),now),expected);
  }
});
test('invalid dates never throw and future deadlines are absolute in Vietnam time',()=>{
  for(const value of [null,undefined,'','bad',{},NaN]){
    assert.equal(relativeAdminTime(value,now),'—');assert.equal(absoluteAdminTime(value),'—');
  }
  const future='2026-10-05T00:00:00Z';
  assert.equal(relativeAdminTime(future,now),absoluteAdminTime(future));
  assert.match(absoluteAdminTime(future),/07:00:00/);
  assert.match(absoluteAdminTime(future),/05\/10\/2026/);
});
