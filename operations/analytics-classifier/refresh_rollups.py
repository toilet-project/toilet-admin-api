#!/usr/bin/env python3
"""Refresh only the existing analytics rollups after owned flag changes.

SQL is the deployed toilet-api AnalyticsRepository at
04052fd37311c3c2d9d2e931378df8b93abbcd06. Event rows are never changed here.
Default is read-only; --apply is required for rollup writes.
"""
import argparse
from datetime import date, datetime, timedelta
import json
from pathlib import Path

from classifier import Database, KST, canonical

DIMENSIONS = {
    'PAGE': 'page_key', 'CHANNEL': 'channel_key', 'SOURCE': 'source_key',
    'DEVICE': 'device_type', 'OS': 'os_family', 'BROWSER': 'browser_family',
    'COUNTRY': 'country_code', 'CITY': 'city_name', 'EVENT': 'event_name',
    'EVENT_DETAIL': "CASE WHEN event_detail='' THEN event_name ELSE CONCAT(event_name, ':', event_detail) END",
    'RESULT_BUCKET': 'result_count_bucket', 'CLIENT_CONTEXT': 'client_context',
    'CLIENT_EVIDENCE': 'client_context_evidence', 'ACQUISITION_EVIDENCE': 'acquisition_evidence',
    'ENTRY_NAVIGATION': 'entry_navigation',
}
ENTRY_DIMENSIONS = {'CHANNEL', 'SOURCE', 'CLIENT_CONTEXT', 'CLIENT_EVIDENCE',
                    'ACQUISITION_EVIDENCE', 'ENTRY_NAVIGATION'}


def checked_dates(values, now):
    values = sorted({date.fromisoformat(value) for value in values})
    if len(values) > 35 or any(d > now.date() or d < now.date() - timedelta(days=35) for d in values):
        raise ValueError('ROLLUP_DATE_OUTSIDE_RETENTION')
    return values


def summary_sql(day):
    # The same raw-event metrics as the application; no visitor/session identities leave MySQL.
    return """SELECT JSON_OBJECT('day','%s',
      'activeUsers',COUNT(DISTINCT visitor_hash),
      'newUsers',COUNT(DISTINCT CASE WHEN new_visitor THEN visitor_hash END),
      'sessions',COUNT(DISTINCT CASE WHEN event_name='session_start' THEN session_hash END),
      'views',COALESCE(SUM(event_name='page_view'),0),
      'engagedSessions',COUNT(DISTINCT CASE WHEN event_name='engagement' AND engagement_seconds>=10 THEN session_hash END),
      'keyEvents',COALESCE(SUM(key_event),0),'events',COUNT(*),
      'engagementSeconds',COALESCE(SUM(engagement_seconds),0))
      FROM service_analytics_event WHERE occurred_date='%s' AND traffic_class<>'BOT'""" % (day, day)


def refresh_sql(day, now):
    day = date.fromisoformat(str(day)).isoformat()
    # Production JDBC persists DATETIME as Seoul wall-clock (same as occurred_at).
    calculated = now.astimezone(KST).strftime('%Y-%m-%d %H:%M:%S.%f')
    finalized = int(date.fromisoformat(day) < now.date())
    statements = [
        "DELETE FROM service_analytics_daily_dimension WHERE analytics_date='%s'" % day,
        "DELETE FROM service_analytics_daily_summary WHERE analytics_date='%s'" % day,
        """INSERT INTO service_analytics_daily_summary(
          analytics_date,active_users,new_users,sessions,views,engaged_sessions,key_events,
          event_count,total_engagement_seconds,calculated_at,finalized)
          SELECT '%s',COUNT(DISTINCT visitor_hash),
          COUNT(DISTINCT CASE WHEN new_visitor THEN visitor_hash END),
          COUNT(DISTINCT CASE WHEN event_name='session_start' THEN session_hash END),
          COALESCE(SUM(event_name='page_view'),0),
          COUNT(DISTINCT CASE WHEN event_name='engagement' AND engagement_seconds>=10 THEN session_hash END),
          COALESCE(SUM(key_event),0),COUNT(*),COALESCE(SUM(engagement_seconds),0),'%s',%d
          FROM service_analytics_event WHERE occurred_date='%s' AND traffic_class<>'BOT'"""
          % (day, calculated, finalized, day),
    ]
    for kind, expression in DIMENSIONS.items():
        extra = " AND result_count_bucket<>''" if kind == 'RESULT_BUCKET' else (
            " AND event_name='session_start'" if kind in ENTRY_DIMENSIONS else '')
        statements.append("""INSERT INTO service_analytics_daily_dimension(
          analytics_date,dimension_type,dimension_key,dimension_label,active_users,views,sessions,
          event_count,key_events,engagement_seconds)
          SELECT occurred_date,'%s',%s,%s,COUNT(DISTINCT visitor_hash),
          COALESCE(SUM(event_name='page_view'),0),COUNT(DISTINCT session_hash),COUNT(*),
          COALESCE(SUM(key_event),0),COALESCE(SUM(engagement_seconds),0)
          FROM service_analytics_event WHERE occurred_date='%s' AND traffic_class<>'BOT'%s
          GROUP BY occurred_date,%s""" % (kind, expression, expression, day, extra, expression))
    return statements


def refresh(database, dates, now, apply=False):
    dates = checked_dates(dates, now)
    plan = {'schema': 1, 'source': 'automation-statistics-rollups',
            'status': 'plan', 'generatedAt': now.isoformat(),
            'dates': [str(day) for day in dates], 'rawNonBot': [], 'changedEventRows': 0}
    if not apply:
        for day in dates:
            plan['rawNonBot'].append(json.loads(database.select(summary_sql(day)).strip()))
        return plan
    plan['status'] = 'ready'
    for day in dates:
        transaction = database.transaction()
        try:
            if transaction.execute("SELECT GET_LOCK('geupddong-analytics-classifier-rollups',2)") != ['1']:
                raise RuntimeError('ROLLUP_LOCK_UNAVAILABLE')
            for statement in refresh_sql(day, now):
                transaction.execute(statement)
            # Read within the same transaction: exactly the snapshot used by INSERT SELECT.
            plan['rawNonBot'].append(json.loads(transaction.execute(summary_sql(day))[0]))
            transaction.execute('COMMIT')
        finally:
            transaction.close()
    return plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', action='append', default=[])
    parser.add_argument('--dates-export', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    values = args.date
    if args.dates_export:
        report = json.loads(args.dates_export.read_text())
        if report.get('source') != 'automation-statistics' or report.get('status') != 'ready':
            raise RuntimeError('CLASSIFICATION_EXPORT_NOT_READY')
        values += report.get('affectedDates', [])
    result = refresh(Database(), values, datetime.now(KST), args.apply)
    print(canonical(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(canonical({'source': 'automation-statistics-rollups', 'status': 'error',
                         'errorCode': str(error) if str(error).isupper() and len(str(error)) < 80 else type(error).__name__}))
        raise SystemExit(1)
