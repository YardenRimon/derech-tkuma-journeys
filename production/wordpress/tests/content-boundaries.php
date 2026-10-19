<?php
// Pure validation tests. No WordPress install, credentials, database, or network.
define('ABSPATH', '/unused/');
function add_action(...$args) {}
function add_filter(...$args) {}
function wp_parse_url($url) { return parse_url($url); }
function esc_url_raw($url, $protocols) { return $url; }
function get_post_meta($id, $key, $single) { return $GLOBALS['test_meta'][$id][$key] ?? ''; }
require __DIR__ . '/../wp-content/mu-plugins/derech-content.php';
$checks = 0;
function check($condition, $message) {
    global $checks;
    if (!$condition) { fwrite(STDERR, $message . "\n"); exit(1); }
    $checks++;
}
check(derech_normalize_legacy_path('/מסלולים/עוז-מול-תופת/') !== false, 'Hebrew source path must survive');
foreach (['/../private/', '//external.test/', '/tour/?admin=1', '/tour/#fragment', '/%2e%2e/private/'] as $path) {
    check(derech_normalize_legacy_path($path) === false, 'Unsafe path accepted');
}
check(derech_price_agorot('123.45') === 12345, 'Price minor units changed');
foreach (['-1', '1.234', '1e3', 'NaN', '1,000', ' 1'] as $price) {
    check(derech_price_agorot($price) === false, 'Invalid price accepted');
}
check(derech_parse_local_start('2026-03-27T02:30') === false, 'Spring DST nonexistent time accepted');
check(derech_parse_local_start('2026-10-25T01:30') === false, 'Autumn DST ambiguous time accepted');
check(derech_parse_local_start('2026-10-25T12:00') instanceof DateTimeImmutable, 'Valid Israel time rejected');
check(derech_valid_booking_url('https://booking.example/pay') === false, 'Booking must default to deny');
define('DERECH_GROW_ALLOWED_HOSTS', ['booking.example']);
check(derech_valid_booking_url('https://booking.example/pay') !== false, 'Exact booking host rejected');
foreach (['http://booking.example/pay', 'https://booking.example.evil/pay', 'https://user@booking.example/pay', 'https://booking.example:444/pay', 'https://booking.example/pay#token'] as $url) {
    check(derech_valid_booking_url($url) === false, 'Unsafe booking URL accepted');
}
$GLOBALS['test_meta'][1]['_derech_tour_status'] = 'open';
$start = new DateTimeImmutable('2030-01-01T12:00:00+02:00');
check(!derech_booking_open(1, $start, 'https://booking.example/pay', 0), 'External actions must default to disabled');
define('DERECH_EXTERNAL_ACTIONS_ENABLED', true);
check(derech_booking_open(1, $start, 'https://booking.example/pay', 0), 'Approved future open booking rejected');
$GLOBALS['test_meta'][1]['_derech_tour_status'] = 'closed';
check(!derech_booking_open(1, $start, 'https://booking.example/pay', 0), 'Closed tour accepted a booking');
$GLOBALS['test_meta'][1]['_derech_tour_status'] = 'open';
check(!derech_booking_open(1, $start, 'https://booking.example/pay', $start->getTimestamp()), 'Past occurrence accepted a booking');
echo json_encode(['status' => 'ok', 'boundary_assertions' => $checks]) . "\n";
