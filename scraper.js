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
var regexHansard = new RegExp('^.+\\(.+\\)( \\([0-9]{1,2}:[0-9]{2}\\))?:','i');
var regexPMHansard = new RegExp("^Mr Turnbull \\(.+\\)( \\([0-9]{1,2}:[0-9]{2}\\))?:", 'i');
var regexPrefix = /^.{1,50}:/i;
var regexPMPrefix = /^Mr Turnbull:/i;

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
				console.log("Error requesting page: " + error);
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
	$content.children().each(function() {
		var par = $(this).text().trim();

		// Take out some stuff
		if (/^E\&OE/.test($(this).text())) return;

		if (isHeading(this)) {
			isPM = isPMHeading(this);
			// Don't take headings
			return;
		}

		if (isPrefixed(this)) {
			isPM = isPMPrefixed(this);
			// remove prefix
			par = par.replace(regexPMPrefix,'');
		}

		if (isHansard(this)) {
			isPM = isPMHansard(this);
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



	function isHansard(el) {
		return regexHansard.test($(el).text().trim());
	}

	function isPMHansard(el) {
		return regexPMHansard.test($(el).text().trim());
	}

	function isPrefixed(el) {
		return regexPrefix.test($(el).text().trim()) && $(el).children() && $(el).children().first().is('strong');
	}

	function isPMPrefixed(el) {
		return regexPMPrefix.test($(el).text().trim());
	}

	function isHeading(el) {
		return ($(el).children() && $(el).children().first().is('strong')) && /^.+:?$/.test($(el).text().trim());
	}

	function isPMHeading(el) {
		var txt = $(el).text().trim();
		return isHeading(el) && (/^PRIME MINISTER/i.test(txt) || /^(MALCOLM )?TURNBULL/i.test(txt));
	}
}

function handleErr(err) {
	setImmediate(()=>{
		throw err;
	});
}