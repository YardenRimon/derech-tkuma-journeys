<?php
/** Plugin Name: Derech staging boundaries */
defined('ABSPATH') || exit;
// Enforce at execution, rather than trusting the admin UI or an imported setting.
if (!defined('DERECH_EXTERNAL_ACTIONS_ENABLED') || !DERECH_EXTERNAL_ACTIONS_ENABLED) {
    add_filter('pre_wp_mail', '__return_false');
    add_filter('pre_option_blog_public', function () { return '0'; });
    add_action('send_headers', function () {
        header('X-Robots-Tag: noindex, nofollow, noarchive', true);
    });
    add_filter('xmlrpc_enabled', '__return_false');
}
