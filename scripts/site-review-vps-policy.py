"""Pure external-watchdog candidate policy. No I/O, scheduler or notifications.

Caller owns trusted durable CAS state and must run the exact shared Jerusalem
calendar before network and again before any eventual write. This preparation
does not provide that runtime integration or prove delivery to a human.
"""
import copy
import math

SCHEMA = 'derech-vps-watchdog/v1'
SCOPE = 'derech:owner-vps'


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def transition(previous, response, *, now, allowed):
    if not number(now):
        raise ValueError('clock_invalid')
    state = copy.deepcopy(previous) if previous is not None else {
        'schema': SCHEMA, 'scope': SCOPE, 'generation': 0, 'lastCheck': None,
        'lastHeartbeat': None, 'failures': [], 'incident': None,
    }
    if state.get('schema') != SCHEMA or state.get('scope') != SCOPE:
        raise ValueError('scope_invalid')
    if allowed is not True:
        return state, {'state': 'held', 'event': None}
    last = state['lastCheck']
    if last is not None and (not number(last) or now <= last):
        raise ValueError('clock_invalid')
    # Failed network/auth/store reads cannot establish a failed VPS heartbeat.
    if response is None:
        state['failures'] = []
        if state['incident']:
            state['incident'].pop('healthyAt', None)
        return state, {'state': 'internal_only', 'event': None}
    if (set(response) != {'schema', 'checkedAt', 'heartbeat'}
            or response['schema'] != 'derech-vps-heartbeat/v1'
            or not number(response['checkedAt']) or not 0 <= now-response['checkedAt'] <= 90):
        raise ValueError('observation_invalid')
    heartbeat = response['heartbeat']
    if (not isinstance(heartbeat, dict) or set(heartbeat) != {'schema', 'observedAt', 'receivedAt', 'ready'}
            or heartbeat['schema'] != response['schema'] or type(heartbeat['ready']) is not bool
            or any(not number(heartbeat[k]) for k in ('observedAt', 'receivedAt'))
            or abs(heartbeat['observedAt']-heartbeat['receivedAt']) > 60
            or heartbeat['receivedAt'] > response['checkedAt']):
        raise ValueError('heartbeat_invalid')
    at = heartbeat['observedAt']
    if state['lastHeartbeat'] is not None and at < state['lastHeartbeat']:
        raise ValueError('heartbeat_regressed')
    state['lastHeartbeat'] = at
    state['lastCheck'] = now
    if last is None or now-last > 720:
        state['failures'] = []
    bad = not heartbeat['ready'] or now-heartbeat['receivedAt'] > 600
    incident = state['incident']
    if not bad:
        state['failures'] = []
        if incident:
            incident['healthyAt'] = now
        # Recovery is only a candidate. A caller must independently prove a
        # delivered opening in its approved notification channel, then ack it.
        return state, {'state': 'recovery_candidate' if incident else 'healthy', 'event': None,
                       'incidentId': incident['id'] if incident else None}
    if incident:
        incident.pop('healthyAt', None)
        return state, {'state': 'open', 'event': None, 'incidentId': incident['id']}
    state['failures'] = (state['failures'] + [now])[-8:]
    failures = state['failures']
    if len(failures) >= 3 and failures[-1]-failures[0] >= 900:
        state['generation'] += 1
        incident = {'id': SCOPE+':'+str(state['generation']), 'firstSeen': failures[0]}
        state['incident'] = incident
        return state, {'state': 'opening_candidate', 'event': {
            'kind': 'owner_vps_check_required', 'incidentId': incident['id'],
            'action': 'inspect_owner_vps_and_existing_services',
        }}
    return state, {'state': 'observing', 'event': None}


def acknowledge_recovery(previous, *, incident_id, opening_receipt, now, allowed):
    """Only a separately verified owner acknowledgment is accepted by this prep.

    An issue URL/number or API-created state alone is deliberately insufficient.
    Production must validate the owner/repo/API receipt, not trust this dict.
    """
    state = copy.deepcopy(previous)
    if allowed is not True:
        raise ValueError('time_policy_closed')
    if (state.get('schema') != SCHEMA or state.get('scope') != SCOPE
            or not state.get('incident') or state['incident']['id'] != incident_id
            or not number(now) or not number(state['incident'].get('healthyAt'))
            or not 0 <= now-state['incident']['healthyAt'] <= 90
            or not isinstance(opening_receipt, dict)
            or set(opening_receipt) != {'incidentId', 'ownerAcknowledged'}
            or opening_receipt['incidentId'] != incident_id or opening_receipt['ownerAcknowledged'] is not True):
        raise ValueError('opening_receipt_invalid')
    state['incident'] = None
    state['failures'] = []
    return state
