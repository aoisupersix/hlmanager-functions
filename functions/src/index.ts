import * as functions from 'firebase-functions';
import * as secureCompare from 'secure-compare';

import { adminSdk } from './firebaseConfig'
import { updateDeviceInfo } from './device'
import { updateMemberStatus } from './member'
import * as util from './utils/util';
import * as dUtil from './utils/dateUtil';

const ref = adminSdk.database().ref();

export {
    updateMemberStatus,
    updateDeviceInfo
}

/**
 * ※CRON用（通常は呼ばないこと）
 * 0:00に全てのメンバーのログの初期データをデータベースに生成します。
 * Method: PUT
 * Query {
 *   key : 認証用キー
 * }
 */
export const initDailyLog = functions.https.onRequest((req, res) => {
    //リクエストがPUTではない
    if(req.method !== 'PUT') {
        return res.status(405).send("This functions is only used to 'PUT' method.");
    }
    //パラメータ不足
    if(util.ContainsUndefined(req.query.key)) {
        return res.status(400).send("Invalid query parameters.");
    }
    const key = req.query.key;

    //キーが異なる
    if (!secureCompare(key, functions.config().service_account.key)) {
        console.log('The key provided in the request does not match the key set in the environment. Check that', key,
            'matches the cron.key attribute in `firebase env:get`');
        return res.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
            'cron.key environment variable.');
    }

    //更新時間
    const nowDate = dUtil.getJstDate();
    nowDate.setHours(0, 0, 0, 0);
    const update_date = dUtil.getDateString(nowDate);
    const update_day = dUtil.getDayString(nowDate).replace(/\//g, "");

    const promise = ref.child("/members").orderByKey().once("value", (snap) => {
        snap.forEach((member) => {
            //ログ追加
            ref.child(`/logs/${member.key}/${update_day}`).push(
                {
                    date: update_date,
                    update_status: member.child('status').val()
                }
            );
            return null;
        });
    });

    return promise.then((_) => {
        res.status(200).send("done.");
    }).catch((reason) => {
        res.status(500).send(reason);
    });
});

/**
 * ※CRON用（通常は呼ばないこと）
 * 3ヶ月以上古いログを削除します。
 * Method: PUT
 * Query {
 *   key : 認証用キー
 * }
 */
export const deleteOldLogs = functions.https.onRequest((req, res) => {
    //リクエストがPUTではない
    if(req.method !== 'PUT') {
        return res.status(405).send("This functions is only used to 'PUT' method.");
    }
    //パラメータ不足
    if(util.ContainsUndefined(req.query.key)) {
        return res.status(400).send("Invalid query parameters.");
    }
    const key = req.query.key;

    //キーが異なる
    if (!secureCompare(key, functions.config().service_account.key)) {
        console.log('The key provided in the request does not match the key set in the environment. Check that', key,
            'matches the cron.key attribute in `firebase env:get`');
        return res.status(403).send('Security key does not match. Make sure your "key" URL query parameter matches the ' +
            'cron.key environment variable.');
    }

    //3ヶ月以上古いログの削除
    const sepDate = new Date();
    sepDate.setMonth(sepDate.getMonth() -3);
    const promise = ref.child('/logs').orderByKey().once("value", (snap) => {
        snap.forEach((memLogs) => {
            console.log("memLogs:" + memLogs.key)
            memLogs.forEach((log) => {
                const dStr = log.key.slice(0, 4) + "/" + log.key.slice(4, 6) + "/" + log.key.slice(6, 8) + " 00:00:00";
                const d = new Date(dStr);
                console.log("sepDate:" + sepDate.toString() + ",date:" + d.toString());
                if(d < sepDate) {
                    console.log("rem:" + log.key);
                    log.ref.remove().then((_) => { return null; }).catch((reason) => { console.log("remove error:" + reason); return true;})
                }
                return null;
            })
            return null;
        });
    });

    return promise.then((_) => {
        res.status(200).send("done.");
    }).catch((reason) => {
        res.status(500).send(reason);
    });
});

/**
 * パラメータに与えられたデータの期間内にステータスが保持された時間を分単位で取得します。
 * Method: All
 * Query: {
 *   memberId : 取得対象のメンバーID
 *   stateId : 取得対象のステータスID
 *   startDate : 取得開始期間
 *   endDate : 取得終了時間
 * }
 */
export const holdTime = functions.https.onRequest((req, res) => {
    //パラメータ不足
    if(util.ContainsUndefined(req.query.memberId, req.query.stateId, req.query.startDate, req.query.endDate)) {
        return res.status(403).send("Invalid query parameters.");
    }
    const memId: number = +req.query.memberId;
    const stateId: number = +req.query.stateId;
    const startDate = new Date(req.query.startDate);
    const endDate = new Date(req.query.endDate);

    //dateのHour以下は必ず0で初期化する
    startDate.setHours(0);
    startDate.setMinutes(0);
    startDate.setSeconds(0);
    startDate.setMilliseconds(0);
    endDate.setHours(0);
    endDate.setMinutes(0);
    endDate.setSeconds(0);
    endDate.setMilliseconds(0);

    return ref.child(`/logs/${memId}/`).orderByKey().once("value")
    .then((snap) => {
        let holdMinute = 0;
        for(const date: Date = startDate; date.getTime() <= endDate.getTime(); date.setDate(date.getDate() + 1)) {
            const log_key = dUtil.getLogsKeyString(date);
            console.log("================" + log_key + "===============");
            if(snap.hasChild(log_key)) {
                //ステータス時間の計測
                let nowDate = date;
                let nowState: number = -1;
                snap.child(log_key).forEach((logSnap) => {
                    const d = new Date(logSnap.child('date').val());
                    const val: number = logSnap.child('update_status').val();
                    console.log(`log_key Loop(log_key:${log_key},nowDate:${dUtil.getDateString(nowDate)},nowState:${nowState},holdMinute:${holdMinute} => d:${dUtil.getDateString(d)},val:${val})`)
                    if(val !== nowState && nowState === stateId) {
                        //ステータス時間追加
                        console.log(`addHoldMinute Before: ${dUtil.getDateString(nowDate)}, After: ${dUtil.getDateString(d)}, Sub:${Math.floor((d.getTime() - nowDate.getTime()) / (1000 * 60))}`)
                        holdMinute += Math.floor((d.getTime() - nowDate.getTime()) / (1000 * 60));
                    }
                    nowDate = d;
                    nowState = val;
                    return false;
                });
                if(nowState === stateId) {
                    //ステータス時間追加
                    const ed = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
                    console.log(`addHoldMinute Before: ${dUtil.getDateString(nowDate)}, After: ${dUtil.getDateString(ed)}, Sub:${Math.floor((ed.getTime() - nowDate.getTime()) / (1000 * 60))}`)
                    holdMinute += Math.floor((ed.getTime() - nowDate.getTime()) / (1000 * 60));
                }
            }
        }

        return res.status(200).send(holdMinute.toString());
    }).catch((reason) => {
        return res.status(406).send(reason.toString());
    });
});