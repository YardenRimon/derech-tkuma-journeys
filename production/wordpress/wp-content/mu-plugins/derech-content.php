<?php
/**
 * Plugin Name: Derech Hatkuma Content
 * Description: Editorial tour and occurrence records with a small published-only API.
 * Version: 0.1.0
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DERECH_TOUR_TYPE       = 'derech_tour';
const DERECH_OCCURRENCE_TYPE = 'derech_occurrence';
const DERECH_TIMEZONE        = 'Asia/Jerusalem';

add_action( 'init', 'derech_register_content_types' );
add_action( 'add_meta_boxes', 'derech_add_content_meta_boxes' );
add_action( 'save_post_derech_tour', 'derech_save_tour_meta', 10, 2 );
add_action( 'save_post_derech_occurrence', 'derech_save_occurrence_meta', 10, 2 );
add_filter( 'wp_insert_post_data', 'derech_block_unready_publication', 10, 2 );
add_action( 'admin_notices', 'derech_content_admin_notice' );
add_action( 'rest_api_init', 'derech_register_public_routes' );

function derech_register_content_types() {
	register_post_type(
		DERECH_TOUR_TYPE,
		array(
			'labels'              => array(
				'name'          => 'מסלולים',
				'singular_name' => 'מסלול',
				'add_new_item'  => 'הוספת מסלול',
				'edit_item'     => 'עריכת מסלול',
				'all_items'     => 'כל המסלולים',
			),
			'public'              => false,
			'publicly_queryable'  => false,
			'show_ui'             => true,
			'show_in_menu'        => true,
			'show_in_rest'        => false,
			'menu_icon'           => 'dashicons-location-alt',
			'rewrite'             => false,
			'has_archive'         => false,
			'supports'            => array( 'title', 'editor', 'excerpt', 'thumbnail', 'revisions' ),
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
			'exclude_from_search' => true,
		)
	);

	register_post_type(
		DERECH_OCCURRENCE_TYPE,
		array(
			'labels'              => array(
				'name'          => 'מועדי סיור',
				'singular_name' => 'מועד סיור',
				'add_new_item'  => 'הוספת מועד',
				'edit_item'     => 'עריכת מועד',
				'all_items'     => 'כל המועדים',
			),
			'public'              => false,
			'publicly_queryable'  => false,
			'show_ui'             => true,
			'show_in_menu'        => true,
			'show_in_rest'        => false,
			'menu_icon'           => 'dashicons-calendar-alt',
			'rewrite'             => false,
			'has_archive'         => false,
			'supports'            => array( 'title', 'revisions' ),
			'capability_type'     => 'post',
			'map_meta_cap'        => true,
			'exclude_from_search' => true,
		)
	);
}

function derech_add_content_meta_boxes() {
	add_meta_box( 'derech_tour_details', 'פרטי המסלול', 'derech_render_tour_meta_box', DERECH_TOUR_TYPE, 'normal', 'high' );
	add_meta_box( 'derech_occurrence_details', 'פרטי המועד', 'derech_render_occurrence_meta_box', DERECH_OCCURRENCE_TYPE, 'normal', 'high' );
}

function derech_meta_value( $post_id, $key ) {
	return (string) get_post_meta( $post_id, '_derech_' . $key, true );
}

function derech_render_tour_meta_box( $post ) {
	wp_nonce_field( 'derech_save_tour_' . $post->ID, 'derech_tour_nonce' );
	$fields = array(
		'legacy_path'      => array( 'נתיב הכתובת הקיימת', 'text', '/מסלול-קיים/' ),
		'meeting_point'    => array( 'נקודת מפגש', 'text', '' ),
		'duration_minutes' => array( 'משך בדקות', 'number', '' ),
		'audience'         => array( 'קהל יעד', 'textarea', '' ),
		'group_terms'      => array( 'תנאי קבוצות', 'textarea', '' ),
	);
	echo '<div dir="rtl">';
	foreach ( $fields as $key => $field ) {
		$value = derech_meta_value( $post->ID, $key );
		$name  = 'derech_' . $key;
		echo '<p><label for="' . esc_attr( $name ) . '"><strong>' . esc_html( $field[0] ) . '</strong></label><br>';
		if ( 'textarea' === $field[1] ) {
			echo '<textarea class="large-text" rows="3" id="' . esc_attr( $name ) . '" name="' . esc_attr( $name ) . '">' . esc_textarea( $value ) . '</textarea>';
		} else {
			$extra = 'number' === $field[1] ? ' min="1" max="1440" step="1"' : '';
			if ( 'legacy_path' === $key && 'publish' === $post->post_status && '' !== $value ) {
				$extra .= ' readonly';
			}
			echo '<input class="regular-text" type="' . esc_attr( $field[1] ) . '" id="' . esc_attr( $name ) . '" name="' . esc_attr( $name ) . '" value="' . esc_attr( $value ) . '" placeholder="' . esc_attr( $field[2] ) . '"' . $extra . '>';
		}
		echo '</p>';
	}
	$status = derech_meta_value( $post->ID, 'tour_status' );
	echo '<p><label for="derech_tour_status"><strong>מצב המסלול</strong></label><br><select id="derech_tour_status" name="derech_tour_status">';
	foreach ( array( 'planned' => 'בתכנון', 'open' => 'פעיל', 'closed' => 'סגור' ) as $value => $label ) {
		echo '<option value="' . esc_attr( $value ) . '"' . selected( $status, $value, false ) . '>' . esc_html( $label ) . '</option>';
	}
	echo '</select></p>';
	echo '<p><label><input type="checkbox" name="derech_group_terms_confirmed" value="1"' . checked( '1', derech_meta_value( $post->ID, 'group_terms_confirmed' ), false ) . '> תנאי הקבוצות אושרו לפרסום</label></p>';
	echo '<p class="description">נתיב הכתובת הוא הנתיב המקורי של האתר. המסלול נשמר תחילה כטיוטה; פרסום דורש נתיב תקין ותנאים מאושרים אם מולאו.</p>';
	echo '</div>';
}

function derech_render_occurrence_meta_box( $post ) {
	wp_nonce_field( 'derech_save_occurrence_' . $post->ID, 'derech_occurrence_nonce' );
	$tour_id = (int) derech_meta_value( $post->ID, 'tour_id' );
	$tours   = get_posts( array( 'post_type' => DERECH_TOUR_TYPE, 'post_status' => array( 'publish', 'draft', 'pending', 'private' ), 'numberposts' => 500, 'orderby' => 'title', 'order' => 'ASC' ) );
	echo '<div dir="rtl"><p><label for="derech_tour_id"><strong>מסלול</strong></label><br><select id="derech_tour_id" name="derech_tour_id"><option value="">בחר מסלול</option>';
	foreach ( $tours as $tour ) {
		echo '<option value="' . esc_attr( (string) $tour->ID ) . '"' . selected( $tour_id, $tour->ID, false ) . '>' . esc_html( $tour->post_title ) . '</option>';
	}
	echo '</select></p>';
	$fields = array(
		'local_start' => array( 'תאריך ושעה בישראל', 'datetime-local', '' ),
		'capacity'    => array( 'מספר מקומות', 'number', '' ),
		'price_ils'   => array( 'מחיר בש״ח', 'text', '0.00' ),
		'booking_url' => array( 'קישור הזמנה מאושר ב־Grow', 'url', 'https://...' ),
	);
	foreach ( $fields as $key => $field ) {
		$value = 'price_ils' === $key ? derech_price_display( derech_meta_value( $post->ID, 'price_agorot' ) ) : derech_meta_value( $post->ID, $key );
		$name  = 'derech_' . $key;
		$extra = 'capacity' === $key ? ' min="1" max="10000" step="1"' : '';
		echo '<p><label for="' . esc_attr( $name ) . '"><strong>' . esc_html( $field[0] ) . '</strong></label><br><input class="regular-text" type="' . esc_attr( $field[1] ) . '" id="' . esc_attr( $name ) . '" name="' . esc_attr( $name ) . '" value="' . esc_attr( $value ) . '" placeholder="' . esc_attr( $field[2] ) . '"' . $extra . '></p>';
	}
	echo '<p><label><input type="checkbox" name="derech_terms_confirmed" value="1"' . checked( '1', derech_meta_value( $post->ID, 'terms_confirmed' ), false ) . '> מועד, קיבולת ומחיר אושרו לפרסום</label></p>';
	echo '<p class="description">אזור הזמן קבוע לישראל. קישור הזמנה מתקבל רק אחרי הגדרת רשימת מארחי Grow מאושרים בשרת; בהיעדרה הקישור נשאר כבוי. שמור טיוטה עם כל הפרטים, ואז פרסם.</p></div>';
}

function derech_can_save_post( $post_id, $nonce_field, $action ) {
	if ( ! isset( $_POST[ $nonce_field ] ) || ! is_string( $_POST[ $nonce_field ] ) ) {
		return false;
	}
	$nonce = sanitize_text_field( wp_unslash( $_POST[ $nonce_field ] ) );
	return wp_verify_nonce( $nonce, $action )
		&& current_user_can( 'edit_post', $post_id )
		&& ! wp_is_post_revision( $post_id )
		&& ! wp_is_post_autosave( $post_id )
		&& ( ! defined( 'DOING_AUTOSAVE' ) || ! DOING_AUTOSAVE );
}

function derech_submitted( $key ) {
	$name = 'derech_' . $key;
	if ( ! isset( $_POST[ $name ] ) || ! is_string( $_POST[ $name ] ) ) {
		return '';
	}
	return trim( wp_unslash( $_POST[ $name ] ) );
}

function derech_notice( $message ) {
	set_transient( 'derech_cms_notice_' . get_current_user_id(), $message, MINUTE_IN_SECONDS );
}

function derech_content_admin_notice() {
	$key     = 'derech_cms_notice_' . get_current_user_id();
	$message = get_transient( $key );
	if ( ! $message ) {
		return;
	}
	delete_transient( $key );
	echo '<div class="notice notice-warning is-dismissible"><p>' . esc_html( $message ) . '</p></div>';
}

function derech_normalize_legacy_path( $raw ) {
	$path = rawurldecode( $raw );
	if ( strlen( $path ) > 255 || ! preg_match( '#^/(?:[\p{L}\p{N}_-]+/)+$#u', $path ) ) {
		return false;
	}
	return $path;
}

function derech_legacy_path_exists( $path, $post_id ) {
	$matches = get_posts( array(
		'post_type'      => DERECH_TOUR_TYPE,
		'post_status'    => array( 'publish', 'future', 'draft', 'pending', 'private' ),
		'posts_per_page' => 2,
		'fields'         => 'ids',
		'meta_key'       => '_derech_legacy_path',
		'meta_value'     => $path,
		'exclude'        => array( $post_id ),
	) );
	return ! empty( $matches );
}

function derech_save_tour_meta( $post_id, $post ) {
	static $saving = false;
	if ( $saving || ! derech_can_save_post( $post_id, 'derech_tour_nonce', 'derech_save_tour_' . $post_id ) ) {
		return;
	}
	$saving = true;
	$path   = derech_submitted( 'legacy_path' );
	$existing_path = derech_meta_value( $post_id, 'legacy_path' );
	if ( 'publish' === $post->post_status && '' !== $existing_path && $path !== $existing_path ) {
		derech_notice( 'נתיב מסלול שפורסם נעול. יש להחזיר אותו לטיוטה לפני שינוי כתובת מתוכנן.' );
	} elseif ( '' !== $path ) {
		$path = derech_normalize_legacy_path( $path );
		if ( false === $path || derech_legacy_path_exists( $path, $post_id ) ) {
			derech_notice( 'נתיב המסלול אינו תקין או כבר קיים. הנתיב הקודם נשמר.' );
		} else {
			update_post_meta( $post_id, '_derech_legacy_path', $path );
		}
	} else {
		delete_post_meta( $post_id, '_derech_legacy_path' );
	}
	foreach ( array( 'meeting_point', 'audience', 'group_terms' ) as $key ) {
		$value = derech_submitted( $key );
		update_post_meta( $post_id, '_derech_' . $key, 'meeting_point' === $key ? sanitize_text_field( $value ) : sanitize_textarea_field( $value ) );
	}
	$duration = derech_submitted( 'duration_minutes' );
	if ( '' === $duration ) {
		delete_post_meta( $post_id, '_derech_duration_minutes' );
	} elseif ( preg_match( '/^[1-9][0-9]{0,3}$/D', $duration ) && (int) $duration <= 1440 ) {
		update_post_meta( $post_id, '_derech_duration_minutes', (int) $duration );
	} else {
		derech_notice( 'משך המסלול חייב להיות מספר שלם בין 1 ל־1440 דקות. הערך הקודם נשמר.' );
	}
	$status = derech_submitted( 'tour_status' );
	update_post_meta( $post_id, '_derech_tour_status', in_array( $status, array( 'planned', 'open', 'closed' ), true ) ? $status : 'planned' );
	update_post_meta( $post_id, '_derech_group_terms_confirmed', isset( $_POST['derech_group_terms_confirmed'] ) ? '1' : '0' );
	derech_demote_if_unready( $post_id, $post );
	$saving = false;
}

function derech_parse_local_start( $raw ) {
	if ( ! preg_match( '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/D', $raw ) ) {
		return false;
	}
	$zone = new DateTimeZone( DERECH_TIMEZONE );
	$date = DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i', $raw, $zone );
	if ( ! $date || $date->format( 'Y-m-d\TH:i' ) !== $raw ) {
		return false;
	}
	// A fall-back hour has two possible instants. Reject it instead of silently picking one.
	$naive       = DateTimeImmutable::createFromFormat( '!Y-m-d\TH:i', $raw, new DateTimeZone( 'UTC' ) );
	$transitions = $zone->getTransitions( $date->getTimestamp() - 172800, $date->getTimestamp() + 172800 );
	if ( $naive && is_array( $transitions ) ) {
		$previous = null;
		foreach ( $transitions as $transition ) {
			if ( null !== $previous && $transition['offset'] < $previous['offset'] ) {
				$repeated_start = $transition['ts'] + $transition['offset'];
				$repeated_end   = $transition['ts'] + $previous['offset'];
				if ( $naive->getTimestamp() >= $repeated_start && $naive->getTimestamp() < $repeated_end ) {
					return false;
				}
			}
			$previous = $transition;
		}
	}
	return $date;
}

function derech_price_agorot( $raw ) {
	if ( ! preg_match( '/^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,2}))?$/D', $raw, $match ) ) {
		return false;
	}
	return (int) $match[1] * 100 + (int) str_pad( isset( $match[2] ) ? $match[2] : '0', 2, '0' );
}

function derech_price_display( $agorot ) {
	if ( '' === $agorot || ! ctype_digit( $agorot ) ) {
		return '';
	}
	return sprintf( '%d.%02d', intdiv( (int) $agorot, 100 ), (int) $agorot % 100 );
}

function derech_allowed_grow_hosts() {
	if ( ! defined( 'DERECH_GROW_ALLOWED_HOSTS' ) || ! is_array( DERECH_GROW_ALLOWED_HOSTS ) ) {
		return array();
	}
	$hosts = array_filter( DERECH_GROW_ALLOWED_HOSTS, 'is_string' );
	return array_values( array_map( 'strtolower', $hosts ) );
}

function derech_valid_booking_url( $url ) {
	if ( '' === $url || preg_match( '/[\s\\\\]/', $url ) ) {
		return false;
	}
	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'] ) || 'https' !== strtolower( $parts['scheme'] ) ) {
		return false;
	}
	if ( isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['fragment'] ) || ( isset( $parts['port'] ) && 443 !== (int) $parts['port'] ) ) {
		return false;
	}
	$host = strtolower( rtrim( $parts['host'], '.' ) );
	if ( $host !== strtolower( $parts['host'] ) || ! in_array( $host, derech_allowed_grow_hosts(), true ) ) {
		return false;
	}
	return esc_url_raw( $url, array( 'https' ) );
}

function derech_save_occurrence_meta( $post_id, $post ) {
	static $saving = false;
	if ( $saving || ! derech_can_save_post( $post_id, 'derech_occurrence_nonce', 'derech_save_occurrence_' . $post_id ) ) {
		return;
	}
	$saving = true;
	$tour_id = derech_submitted( 'tour_id' );
	if ( ctype_digit( $tour_id ) && DERECH_TOUR_TYPE === get_post_type( (int) $tour_id ) ) {
		update_post_meta( $post_id, '_derech_tour_id', (int) $tour_id );
	} else {
		delete_post_meta( $post_id, '_derech_tour_id' );
	}
	$raw_start = derech_submitted( 'local_start' );
	$start     = derech_parse_local_start( $raw_start );
	if ( $start ) {
		update_post_meta( $post_id, '_derech_local_start', $raw_start );
		update_post_meta( $post_id, '_derech_start_utc', $start->setTimezone( new DateTimeZone( 'UTC' ) )->format( 'Y-m-d\TH:i:s\Z' ) );
	} else {
		delete_post_meta( $post_id, '_derech_local_start' );
		delete_post_meta( $post_id, '_derech_start_utc' );
		if ( '' !== $raw_start ) {
			derech_notice( 'תאריך או שעה אינם תקינים בישראל, כולל שעה עמומה במעבר שעון. המועד נשאר טיוטה.' );
		}
	}
	$capacity = derech_submitted( 'capacity' );
	if ( preg_match( '/^[1-9][0-9]{0,4}$/D', $capacity ) && (int) $capacity <= 10000 ) {
		update_post_meta( $post_id, '_derech_capacity', (int) $capacity );
	} else {
		delete_post_meta( $post_id, '_derech_capacity' );
		if ( '' !== $capacity ) {
			derech_notice( 'מספר המקומות חייב להיות מספר שלם בין 1 ל־10000. המועד נשאר טיוטה.' );
		}
	}
	$price = derech_price_agorot( derech_submitted( 'price_ils' ) );
	if ( false !== $price ) {
		update_post_meta( $post_id, '_derech_price_agorot', $price );
	} else {
		delete_post_meta( $post_id, '_derech_price_agorot' );
		if ( '' !== derech_submitted( 'price_ils' ) ) {
			derech_notice( 'מחיר המועד חייב להיות בשקלים עם עד שתי ספרות אחרי הנקודה. המועד נשאר טיוטה.' );
		}
	}
	$url = derech_submitted( 'booking_url' );
	if ( '' === $url ) {
		delete_post_meta( $post_id, '_derech_booking_url' );
	} else {
		$valid_url = derech_valid_booking_url( $url );
		if ( $valid_url ) {
			update_post_meta( $post_id, '_derech_booking_url', $valid_url );
		} else {
			delete_post_meta( $post_id, '_derech_booking_url' );
			derech_notice( 'קישור הזמנה לא נשמר: נדרש HTTPS ומארח Grow שאושר במפורש בשרת.' );
		}
	}
	update_post_meta( $post_id, '_derech_terms_confirmed', isset( $_POST['derech_terms_confirmed'] ) ? '1' : '0' );
	derech_demote_if_unready( $post_id, $post );
	$saving = false;
}

function derech_ready_to_publish( $post_id, $type ) {
	if ( DERECH_TOUR_TYPE === $type ) {
		$path  = derech_meta_value( $post_id, 'legacy_path' );
		$terms = derech_meta_value( $post_id, 'group_terms' );
		$status = derech_meta_value( $post_id, 'tour_status' );
		return false !== derech_normalize_legacy_path( $path )
			&& ! derech_legacy_path_exists( $path, $post_id )
			&& in_array( $status, array( 'planned', 'open', 'closed' ), true )
			&& ( '' === $terms || '1' === derech_meta_value( $post_id, 'group_terms_confirmed' ) );
	}
	if ( DERECH_OCCURRENCE_TYPE === $type ) {
		$tour_id = (int) derech_meta_value( $post_id, 'tour_id' );
		$capacity = derech_meta_value( $post_id, 'capacity' );
		$price = derech_meta_value( $post_id, 'price_agorot' );
		return $tour_id > 0
			&& DERECH_TOUR_TYPE === get_post_type( $tour_id )
			&& 'publish' === get_post_status( $tour_id )
			&& derech_parse_local_start( derech_meta_value( $post_id, 'local_start' ) )
			&& preg_match( '/^[1-9][0-9]{0,4}$/D', $capacity )
			&& (int) $capacity <= 10000
			&& ctype_digit( $price )
			&& '1' === derech_meta_value( $post_id, 'terms_confirmed' );
	}
	return false;
}

function derech_block_unready_publication( $data, $postarr ) {
	if ( ! in_array( $data['post_type'], array( DERECH_TOUR_TYPE, DERECH_OCCURRENCE_TYPE ), true ) || ! in_array( $data['post_status'], array( 'publish', 'future' ), true ) ) {
		return $data;
	}
	$post_id = isset( $postarr['ID'] ) ? (int) $postarr['ID'] : 0;
	if ( ! $post_id || ! derech_ready_to_publish( $post_id, $data['post_type'] ) ) {
		$data['post_status'] = 'draft';
		derech_notice( 'הפרסום נעצר: יש לשמור תחילה טיוטה עם נתיב/תנאים מאושרים או פרטי מועד מלאים, ואז לפרסם.' );
	}
	return $data;
}

function derech_demote_if_unready( $post_id, $post ) {
	if ( 'publish' !== $post->post_status && 'future' !== $post->post_status ) {
		return;
	}
	if ( derech_ready_to_publish( $post_id, $post->post_type ) ) {
		return;
	}
	wp_update_post( array( 'ID' => $post_id, 'post_status' => 'draft' ) );
	derech_notice( 'הרשומה הוחזרה לטיוטה משום שחסר תנאי פרסום מאושר.' );
}

function derech_register_public_routes() {
	register_rest_route( 'derech/v1', '/tours', array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => '__return_true',
		'callback'            => 'derech_public_tours',
		'schema'              => 'derech_tours_schema',
		'args'                => array( 'path' => array( 'type' => 'string', 'required' => false ) ),
	) );
	register_rest_route( 'derech/v1', '/occurrences', array(
		'methods'             => WP_REST_Server::READABLE,
		'permission_callback' => '__return_true',
		'callback'            => 'derech_public_occurrences',
		'schema'              => 'derech_occurrences_schema',
		'args'                => array( 'tour_id' => array( 'type' => 'integer', 'required' => false, 'minimum' => 1 ) ),
	) );
}

function derech_tours_schema() {
	return array(
		'$schema' => 'http://json-schema.org/draft-04/schema#',
		'title'   => 'derech_tours',
		'type'    => 'array',
		'items'   => array(
			'type'       => 'object',
			'properties' => array(
				'id'               => array( 'type' => 'integer' ),
				'title'            => array( 'type' => 'string' ),
				'legacy_path'      => array( 'type' => 'string' ),
				'excerpt'          => array( 'type' => 'string' ),
				'content_html'     => array( 'type' => 'string' ),
				'featured_media'   => array( 'type' => array( 'string', 'null' ) ),
				'meeting_point'    => array( 'type' => 'string' ),
				'duration_minutes' => array( 'type' => 'integer' ),
				'audience'         => array( 'type' => 'string' ),
				'status'           => array( 'type' => 'string', 'enum' => array( 'planned', 'open', 'closed' ) ),
				'group_terms'      => array( 'type' => 'string' ),
			),
		),
	);
}

function derech_occurrences_schema() {
	return array(
		'$schema' => 'http://json-schema.org/draft-04/schema#',
		'title'   => 'derech_occurrences',
		'type'    => 'array',
		'items'   => array(
			'type'       => 'object',
			'properties' => array(
				'id'              => array( 'type' => 'integer' ),
				'tour_id'         => array( 'type' => 'integer' ),
				'title'           => array( 'type' => 'string' ),
				'starts_at'       => array( 'type' => 'string', 'format' => 'date-time' ),
				'timezone'        => array( 'type' => 'string', 'enum' => array( DERECH_TIMEZONE ) ),
				'capacity'        => array( 'type' => 'integer' ),
				'price'           => array( 'type' => 'object', 'properties' => array( 'amount_minor' => array( 'type' => 'integer' ), 'currency' => array( 'type' => 'string', 'enum' => array( 'ILS' ) ) ) ),
				'booking_url'     => array( 'type' => array( 'string', 'null' ) ),
				'booking_enabled' => array( 'type' => 'boolean' ),
			),
		),
	);
}

function derech_public_tours( $request ) {
	$args = array( 'post_type' => DERECH_TOUR_TYPE, 'post_status' => 'publish', 'posts_per_page' => 100, 'orderby' => 'menu_order title', 'order' => 'ASC' );
	if ( $request->has_param( 'path' ) ) {
		$path = derech_normalize_legacy_path( (string) $request->get_param( 'path' ) );
		if ( false === $path ) {
			return new WP_Error( 'derech_invalid_path', 'נתיב מסלול לא תקין', array( 'status' => 400 ) );
		}
		$args['meta_key']   = '_derech_legacy_path';
		$args['meta_value'] = $path;
	}
	$items = array();
	foreach ( get_posts( $args ) as $post ) {
		if ( ! derech_ready_to_publish( $post->ID, DERECH_TOUR_TYPE ) ) {
			continue;
		}
		$terms = derech_meta_value( $post->ID, 'group_terms' );
		$items[] = array(
			'id'               => $post->ID,
			'title'            => get_the_title( $post ),
			'legacy_path'      => derech_meta_value( $post->ID, 'legacy_path' ),
			'excerpt'          => get_the_excerpt( $post ),
			'content_html'     => apply_filters( 'the_content', $post->post_content ),
			'featured_media'   => get_post_thumbnail_id( $post->ID ) ? ( wp_get_attachment_image_url( get_post_thumbnail_id( $post->ID ), 'full' ) ?: null ) : null,
			'meeting_point'    => derech_meta_value( $post->ID, 'meeting_point' ),
			'duration_minutes' => (int) derech_meta_value( $post->ID, 'duration_minutes' ),
			'audience'         => derech_meta_value( $post->ID, 'audience' ),
			'status'           => derech_meta_value( $post->ID, 'tour_status' ),
			'group_terms'      => '1' === derech_meta_value( $post->ID, 'group_terms_confirmed' ) ? $terms : '',
		);
	}
	return rest_ensure_response( $items );
}

function derech_booking_open( $tour_id, $start, $url, $now = null ) {
	return defined( 'DERECH_EXTERNAL_ACTIONS_ENABLED' ) && DERECH_EXTERNAL_ACTIONS_ENABLED
		&& $url && $start instanceof DateTimeImmutable
		&& $start->getTimestamp() > ( null === $now ? time() : $now )
		&& 'open' === derech_meta_value( $tour_id, 'tour_status' );
}

function derech_public_occurrences( $request ) {
	$args = array( 'post_type' => DERECH_OCCURRENCE_TYPE, 'post_status' => 'publish', 'posts_per_page' => 100, 'meta_key' => '_derech_start_utc', 'orderby' => 'meta_value', 'order' => 'ASC' );
	if ( $request->has_param( 'tour_id' ) ) {
		$args['meta_query'] = array( array( 'key' => '_derech_tour_id', 'value' => (int) $request->get_param( 'tour_id' ), 'compare' => '=' ) );
	}
	$items = array();
	foreach ( get_posts( $args ) as $post ) {
		if ( ! derech_ready_to_publish( $post->ID, DERECH_OCCURRENCE_TYPE ) ) {
			continue;
		}
		$start = derech_parse_local_start( derech_meta_value( $post->ID, 'local_start' ) );
		if ( ! $start ) {
			continue;
		}
		$url = derech_valid_booking_url( derech_meta_value( $post->ID, 'booking_url' ) );
		$booking_open = derech_booking_open( (int) derech_meta_value( $post->ID, 'tour_id' ), $start, $url );
		$items[] = array(
			'id'            => $post->ID,
			'tour_id'       => (int) derech_meta_value( $post->ID, 'tour_id' ),
			'title'         => get_the_title( $post ),
			'starts_at'     => $start->format( DateTimeInterface::ATOM ),
			'timezone'      => DERECH_TIMEZONE,
			'capacity'      => (int) derech_meta_value( $post->ID, 'capacity' ),
			'price'         => array( 'amount_minor' => (int) derech_meta_value( $post->ID, 'price_agorot' ), 'currency' => 'ILS' ),
			'booking_url'   => $booking_open ? $url : null,
			'booking_enabled' => (bool) $booking_open,
		);
	}
	return rest_ensure_response( $items );
}
