const cron = require("node-cron");
const express = require("express");
const fs = require("fs");
const puppeteer = require('puppeteer');
const credentials = require('./credentials');
const config = require('./config');
let mysql  = require('mysql');
app = express();

// schedule tasks to be run on the server   
async function initialize() {
  //console.log('Begin');
  let connection = mysql.createConnection(config);
  connection.query("SELECT job_id FROM medefis_jobs WHERE job_status <> 'Closed'", function(err, result){
    if(result.length > 0) {
      connection.end();
      autoUpdate(result);
    } else {
      connection.end();
    }
  }); 
}

  /************ START UPDATE JOBS ************/
  async function autoUpdate (current_jobs) {
    let auto_update_page
    let auto_update_browser
    let start_scrape = new Date();
    let connection = mysql.createConnection(config);
    let session_id;
    let today;
    let date;
    let time;
    let dateTime;

    try {
      //current datetime start
      today = new Date();
      date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
      time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
      dateTime = date+' '+time;

      //insert logs
      const log_stmt = `INSERT INTO cron_job_sessions(session_name,session_date,session_start)
      VALUES(?,?,?)`;

      // execute the insert statment
      const log_data = [
        'medefis update jobs',
        date,
        dateTime
      ];

      connection.query(log_stmt, log_data, (err, results, fields) => {
        if (err) throw err;
        session_id = results.insertId;
      });

      auto_update_browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--window-size=1920,1080'
        ]
      })

      //create new page
      auto_update_page = await auto_update_browser.newPage()
      auto_update_page.setViewport({height: 1080, width: 1920})

      //go to login page
      //console.log('Redirect to in login')
      await auto_update_page.goto('https://vms.medefis5.com/',  {waitUntil : "load"})
      await auto_update_page.waitFor(() => document.querySelector('[name=username]'))
      await auto_update_page.waitFor(() => document.querySelector('[name=password]'))
      await auto_update_page.waitFor(8000);

      await auto_update_page.type('[name=username]', credentials.username, {delay: 50})
      await auto_update_page.type('[name=password]', credentials.password, {delay: 50})

      await auto_update_page.evaluate(() => {
        document.querySelector('.btn-primary').click()
      })

      await auto_update_page.waitFor(8000);

      if(current_jobs.length > 0) {
        for (var k = 0; k < current_jobs.length; k++) {
          //console.log(`Go to job_id ${current_jobs[k].job_id}`)
          await auto_update_page.goto(`https://vms.medefis5.com/jobs/${current_jobs[k].job_id}`,  {waitUntil : "load"})
          await auto_update_page.waitFor(() => document.querySelector('.agency-candidate-submissions'))
          await auto_update_page.waitFor(4000);

          const current_job_status = await auto_update_page.evaluate(() => {
            return document.querySelector('.job-info-header .row:nth-child(1) .form-group-wrapper-whole .form-third:nth-child(1) .form-control-static').innerText.trim();
          })
          
          if (current_job_status == 'Closed') {
            //Update
            var sql = `UPDATE medefis_jobs SET job_status = 'Closed' WHERE job_id = '${current_jobs[k].job_id}'`;
            connection.query(sql);
          }
        }
      }
      await auto_update_page.waitFor(1000)
      await auto_update_browser.close()
    } catch (err) {
      log_message = err.message;
      //console.log('Error: '+log_message)
      log_status = 'failed';
      await auto_update_page.waitFor(1000)
      await auto_update_browser.close()

      const end_scrape = new Date() - start_scrape
      //current datetime start
      today = new Date();
      date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
      time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
      dateTime = date+' '+time;
      var sql = `UPDATE cron_job_sessions SET session_end = '${dateTime}', time_elapsed = '${end_scrape}', details = '${log_message}', status = '${log_status}' WHERE id = '${session_id}'`;
      connection.query(sql);
      connection.end();
    } 
    
  }
  /************ END UPDATE JOBS ************/

// schedule tasks to be run on the server   
cron.schedule("0 0 */2 * * *", function() {
  initialize();
});
app.listen(3001);