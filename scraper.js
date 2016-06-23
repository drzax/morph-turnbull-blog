// This is a template for a Node.js scraper on morph.io (https://morph.io)

var cheerio = require("cheerio");
var request = require("request");
var moment = require('moment');
var sqlite3 = require("sqlite3").verbose();
var fs = require('fs');
var path = require('path');
var queue = require('queue-async');

var db;
var q;
var fetched = [];
var regexHansard = /^.+\(.+\)(\s\([0-9]{1,2}:[0-9]{2}\))?:/i;
var regexPMHansard = /^(Mr|Malcolm)\sTurnbull\s\(.+\)(\s\([0-9]{1,2}:[0-9]{2}\))?:/i;
var regexPrefix = /^.{1,50}:/i;
var regexPMPrefix = /^((Mr|Malcolm)\sTurnbull|Prime\sMinister):/i;

const DOMAIN = 'http://www.malcolmturnbull.com.au';
const URL = DOMAIN + '/media';

// Delete existing data
try {
	fs.unlinkSync(path.join(__dirname, 'data.sqlite'));
} catch(e) {}

// Setup the DB
db = new Promise((resolve, reject) => {
	var conn = new sqlite3.Database("data.sqlite");
	conn.serialize(() => {
		conn.run(`CREATE TABLE IF NOT EXISTS data (
			url TEXT PRIMARY KEY,
			title TEXT,
			content TEXT,
			parsed TEXT,
			category TEXT,
			date TEXT)`, (err) => err ? reject(err) : resolve(conn));
	});
});

q = queue(10);
fetchPage(URL, processListing);

function fetchPage(url, callback) {

	// Don' do something again.
	if (fetched.indexOf(url) > -1) return;

	fetched.push(url);

	// Use request to read in pages.
	q.defer(function(cb){

		request(url, function (error, response, body) {
			if (error) {
				console.log(`Error requesting ${url}: ${error}`);
				return;
			}
			callback(body);
			cb();
			if (global.gc) global.gc();
		});
	});
}

function processListing(html){

	var $ = cheerio.load(html);

	$('.col-main .thumb-listing article a').filter(function () {
		return $(this).text() === 'Read more »';
	}).each(function(){
		fetchPage($(this).attr('href'), processDetailPage);
	});

	$('.col-main .thumb-listing .pagination a').each(function() {
		fetchPage($(this).attr('href'), processListing);
	});
}

function processDetailPage(body) {
	var $ = cheerio.load(body), data = {};

	data.$url = $('meta[property="og:url"]').attr('content');
	data.$category = $('.col-main .detail-meta a').last().text().trim();
	data.$title = $('.col-main h1').first().text();

	var $content = $('.col-main').clone();

	// Clean up some stuff we don't want
	$content.children('.breadcrumbs,>h1,.detail-meta,.add-this,script,.comments').remove();

	data.$content = $content.text().trim();
	data.$date = moment($('.col-main .detail-meta').text().split('|')[0].trim(), 'Do MMMM YYYY').toISOString();

	// Parse the content to extract only Turnbull's speech
	data.$parsed = '';
	var isPM = true;
	var whitelist = false;
	data.$content.split("\n").forEach(function(par) {

		par = par.trim();

		// Don't take empty pars
		if (!par.length) return;

		// console.log(par);

		// Don't take silly pars
		if (/^E\&OE/.test(par)) return;
		if (/^EO\&E/.test(par)) return;

		if (isHeading(par)) {
			whitelist = whitelist ||
				data.$category === 'Blog' ||
				/MEDIA\sRELEASE/.test(par) ||
				/CHANGES TO THE MINISTRY/.test(par) ||
				/KEYNOTE ADDRESS/.test(par) ||
				/JOINT STATEMENT/.test(par) ||
				/RESPONSE TO THE SENATE SELECT COMMITTEE ON THE NBN/.test(par) ||
				/ECONOMIC LEADERS MEETING/.test(par);
			isPM = isPMHeading(par) || whitelist;
			// console.log('heading', isPM);
			// Don't take headings
			return;
		}

		if (isPrefixed(par)) {
			isPM = isPMPrefixed(par);
			// console.log('prefix', isPM);
			// remove prefix
			par = par.replace(regexPMPrefix,'');
		}

		if (isHansard(par)) {
			isPM = isPMHansard(par);
			// console.log('hansard', isPM);
			par = par.replace(regexPMHansard,'');
		}

		if (isPM) {
			data.$parsed += (par.trim() + "\n\n");
		}
	});

	data.$parsed = data.$parsed.trim();

	db.then(function(db) {
		console.log(data.$url);
		db.run(`INSERT OR REPLACE INTO data (
			url,
			title,
			content,
			parsed,
			category,
			date
		) VALUES (
			$url,
			$title,
			$content,
			$parsed,
			$category,
			$date
		)`, data, (global.gc) ? global.gc : null);
	}, handleErr);

	function isHansard(par) {
		return regexHansard.test(par);
	}

	function isPMHansard(par) {
		return regexPMHansard.test(par);
	}

	function isPrefixed(par) {
		return regexPrefix.test(par);
	}

	function isPMPrefixed(par) {
		return regexPMPrefix.test(par);
	}

	function isHeading(par) {
		return /^.{0,50}:$/.test(par) || /^[A-Z\s,\-—\./&]+$/.test(par);
	}

	function isPMHeading(par) {
		return isHeading(par) && (
			/^PRIME\sMINISTER/i.test(par) ||
			/^((Mr|MALCOLM)\s)?TURNBULL/i.test(par)
		);
	}
}

function handleErr(err) {
	setImmediate(()=>{
		throw err;
	});
}