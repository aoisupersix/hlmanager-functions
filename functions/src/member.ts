import * as functions from 'firebase-functions';

import { adminSdk } from './firebaseConfig';
import * as notification from './notification';
import * as geofenceConst from './const/geofenceIdentifiers';
import { Status } from './const/states';
import * as dUtil from './utils/dateUtil';

const ref = adminSdk.database().ref();

/**
 * 引数に指定されたデバイスIDのジオフェンス状態を初期化します。
 * @param deviceId デバイスID
 */
function resetGeofenceStatus(deviceId: string): Promise<void> {
  const dict: { [key: string]: boolean; } = {};
  geofenceConst.Identifiers.forEach(i => dict[i] = false);

  return ref.child(`/devices/${deviceId}/geofence_status`).set(dict);
}

/**
 * メンバーが指定されているデバイスのプッシュ通知トークンを取得します。
 * @param memberId メンバーID
 */
function getFcmTokens(memberId: number): Promise<string[]> {
  return new Promise(async (resolve, reject) => {
    const tokens: string[] = [];
    const devSnaps = await ref.child('devices').once('value');
    devSnaps.forEach((devSnap) => {
      if (devSnap.child('member_id').exists() && devSnap.child('fcm_token').exists() && parseInt(devSnap.child('member_id').val()) === memberId) {
        tokens.push(devSnap.child('fcm_token').val());
      }
      return null;
    });
    resolve(tokens);
  });
}

/**
 * Realtime Database Trigger
 * statusが更新された際にログと最終更新を更新します。
 */
export const updateMemberStatus = functions.database.ref('/members/{memberId}/status').onUpdate(async (change, context) => {
  console.log("UpdateStatus member:" + context.params.memberId + ",status(Before):" + change.before.val() + ",status(After):" + change.after.val());
  // 更新時間
  const nowDate = dUtil.getJstDate();
  const update_date = dUtil.getDateString(nowDate);
  const update_day = dUtil.getDayString(nowDate).replace(/\//g, "");

  // 更新ステータスが帰宅でかつ手動更新であれば、更新されたメンバーのデバイスのジオフェンス状態を初期化
  const status = parseInt(change.after.val());
  const lastUpdateIsAuto = await ref.child(`/members/${context.params.memberId}/last_update_is_auto`).once('value');
  if (status === Status.帰宅 && lastUpdateIsAuto.val() === false) {
    const snap = await ref.child('/devices').once('value');
    snap.forEach((devices) => {
      if (parseInt(devices.child('member_id').val()) === parseInt(context.params.memberId)) {
        console.log("Member status has been manually updated to 0, initialize the geofence state.");
        resetGeofenceStatus(devices.key).then((_) => { return null; }).catch((reason) => { console.log("failed initialize geofences:" + reason); return null; });
      }
      else { return null; }
    });
  }

  // 自動更新であればプッシュ通知送信
  if (lastUpdateIsAuto.val() !== false) {
    const tokens = await getFcmTokens(parseInt(context.params.memberId));
    if (tokens.length > 0) {
      await notification.sendNotification(tokens, "ステータス自動更新", `ステータスを「${Status[status]}」に更新しました。`, "");
    }
  }

  return Promise.all([
    ref.child(`/members/${context.params.memberId}/last_update_date`).set(update_date), // 最終更新日時の更新
    ref.child(`/members/${context.params.memberId}/last_status`).set(change.before.val()), // 最終ステータスの更新
    ref.child(`/logs/${context.params.memberId}/${update_day}`).push( // ログ更新
      {
        date: update_date,
        update_status: change.after.val()
      }
    )
  ]);
});