import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import * as util from './util';

admin.initializeApp(functions.config().firebase);

const ref = admin.database().ref();

/**
 * statusが更新された際にログと最終更新を更新します。
 */
export const updateStatusReferences = functions.database.ref('/members/{memberId}/status').onUpdate((change, context) => {
    console.log("UpdateStatus member:" + context.params.memberId + ",status(Before):" + change.before.val() + ",status(After):" + change.after.val());
    //更新時間
    const nowDate = util.getJstDate();
    const update_date = util.getDateString(nowDate);
    const update_day = util.getDayString(nowDate).replace(/\//g, "");
    
    //最終更新
    ref.child(`/members/${context.params.memberId}/last_update_date`).set(update_date);
    ref.child(`/members/${context.params.memberId}/last_status`).set(change.before.val());

    //ログ更新
    return ref.child(`/logs/${context.params.memberId}/${update_day}`).push(
        {
            date: update_date,
            update_status: change.after.val()
        }
    );
});