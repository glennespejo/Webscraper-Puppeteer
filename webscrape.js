const cron = require("node-cron");
const express = require("express");
const fs = require("fs");
const puppeteer = require('puppeteer');
const credentials = require('./credentials');
const config = require('./config');
let mysql  = require('mysql');
app = express();

/************ START GET JOBS ************/
async function autoScrape () {
  //console.log('Begin');
  let log_message;
  let log_status;
  let session_id; 
  let auto_scrape_page;
  let auto_scrape_browser;
  let connection = mysql.createConnection(config);
  const start_scrape = new Date();

  //current datetime start
  let today = new Date();
  let date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
  let time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
  let dateTime = date+' '+time;
  let job_counter = 1;

  //insert logs
  const log_stmt = `INSERT INTO cron_job_sessions(session_name,session_date,session_start)
  VALUES(?,?,?)`;

  // execute the insert statment
  const log_data = [
    'medefis get jobs',
    date,
    dateTime
  ];

  connection.query(log_stmt, log_data, (err, results, fields) => {
    if (err) throw err;
    session_id = results.insertId;
  });

  auto_scrape_browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080'
    ]
  })

  //create new page
  auto_scrape_page = await auto_scrape_browser.newPage()
  auto_scrape_page.setViewport({height: 1080, width: 1920})

  try {  
    //go to login page
    //console.log('Redirect to in login')
    await auto_scrape_page.goto('https://vms.medefis5.com/',  {waitUntil : "load"})
    await auto_scrape_page.waitFor(() => document.querySelector('[name=username]'))
    await auto_scrape_page.waitFor(() => document.querySelector('[name=password]'))
    await auto_scrape_page.waitFor(8000);

    await auto_scrape_page.type('[name=username]', credentials.username, {delay: 50})
    await auto_scrape_page.type('[name=password]', credentials.password, {delay: 50})

    await auto_scrape_page.evaluate(() => {
      document.querySelector('.btn-primary').click()
    })

    await auto_scrape_page.waitFor(5000);
    await auto_scrape_page.goto('https://vms.medefis5.com/Jobs?prefilter=28', {waitUntil : "load"})
    //console.log('Go to job list page')
    await auto_scrape_page.waitFor(() => document.querySelector('.rt-tr-group'))
    await auto_scrape_page.waitFor(3000);

    const totalPage = await auto_scrape_page.evaluate(
      () => document.querySelector('.-totalPages').innerText
    )

    //sort by job status
    await auto_scrape_page.evaluate(() => document.querySelector('.rt-thead.-header .rt-tr .rt-th:nth-child(9)').click()); 
    await auto_scrape_page.evaluate(() => document.querySelector('.rt-thead.-header .rt-tr .rt-th:nth-child(9)').click()); 

    let job_list = [];
    page_loop: 
    for (var i = 0; i < totalPage; i++) {
      
      //console.log(`Get data in page ${i+1}`)
      const jobs = await auto_scrape_page.evaluate(() => 
        Array.from(document.querySelectorAll('.rt-tbody .rt-tr-group')).map(compact => ([{
          job_name: compact.querySelector('.rt-tr div:nth-child(1)').innerText.trim(),
          job_id: compact.querySelector('.rt-tr div:nth-child(2)').innerText.trim(),
          facility: compact.querySelector('.rt-tr div:nth-child(3)').innerText.trim(),
          specialty: compact.querySelector('.rt-tr div:nth-child(4)').innerText.trim(),
          sub_specialty: compact.querySelector('.rt-tr div:nth-child(5)').innerText.trim(),
          job_type: compact.querySelector('.rt-tr div:nth-child(6)').innerText.trim(),
          num_submission: compact.querySelector('.rt-tr div:nth-child(7)').innerText.trim(),
          position_left_posted: compact.querySelector('.rt-tr div:nth-child(8)').innerText.trim(),
          job_status: compact.querySelector('.rt-tr div:nth-child(9)').innerText.trim(),
          start_date: compact.querySelector('.rt-tr div:nth-child(10)').innerText.trim(),
          last_announce_date: compact.querySelector('.rt-tr div:nth-child(11)').innerText.trim(),
          state: compact.querySelector('.rt-tr div:nth-child(12)').innerText.trim(),
        }]))
      )


      for (var x = 0; x < jobs.length; x++) {
        const job = jobs[x][0];
        if (job.job_status == 'Closed') {
          break page_loop
        }
        //console.log(`Go to job_id ${job.job_id}`)
        await auto_scrape_page.goto(`https://vms.medefis5.com/jobs/${job.job_id}`,  {waitUntil : "load"})
        await auto_scrape_page.waitFor(() => document.querySelector('.agency-candidate-submissions'))
        await auto_scrape_page.waitFor(3000);

        const job_other_details = await auto_scrape_page.evaluate(() => 
          Array.from(document.querySelectorAll('.page-body')).map(body => ({
            //other details
            position_urgency: body.querySelector('.job-info-header .row:nth-child(2) .form-group-wrapper-whole .form-third:nth-child(2) .form-control-static').innerText.trim(),
            description: body.querySelector('.job-info-header .row:nth-child(6) .form-group-wrapper-whole .form-group div').innerText.trim(),

            facilities: JSON.stringify(Array.from(body.querySelectorAll('.facility-information div.row:nth-child(1) .form-group')).map(facility => ({
                name: facility.querySelector(':nth-child(1)').innerText.trim(),
                value: facility.querySelector(':nth-child(2)').innerText.trim(),
            }))),

            job_details: JSON.stringify(Array.from(body.querySelectorAll('.job-details .row .form-group')).map(details => ({
                name: details.querySelector(':nth-child(1)').innerText.trim(),
                value: details.querySelector(':nth-child(2)').innerText.trim(),
            }))),

            budget_info: JSON.stringify(Array.from(body.querySelectorAll('.budget-by-type .row .form-group')).map(details => ({
                name: details.querySelector(':nth-child(1)').innerText.trim(),
                value: details.querySelector(':nth-child(2)').innerText.trim(),
            }))),

            candidates: JSON.stringify(Array.from(body.querySelectorAll('.agency-candidate-submissions .accordion-internal-list-row')).map(candidate => ({
              candidate_name: candidate.querySelector('.accordion-internal-list-item:nth-child(1)').innerText.trim(),
              rate: candidate.querySelector('.accordion-internal-list-item:nth-child(2)').innerText.trim(),
              time_submitted: candidate.querySelector('.accordion-internal-list-item:nth-child(3)').innerText.trim(),
              candidate_status: candidate.querySelector('.accordion-internal-list-item:nth-child(4)').innerText.trim(),
            })))
          }))
        )

        const job_data = [
          job.job_name,
          job.facility,
          job.specialty,
          job.sub_specialty,
          job.job_type,
          job.num_submission,
          job.position_left_posted,
          job.job_status,
          job.start_date,
          job.last_announce_date,
          job.state,
          job_other_details[0].position_urgency,
          job_other_details[0].description,
          job_other_details[0].facilities,
          job_other_details[0].job_details,
          job_other_details[0].budget_info,
          job_other_details[0].candidates,
          job.job_id,
        ]

        //Check if data already existing
        //console.log('check job if existing.')
        let select_stmt = `SELECT COUNT(*) as total FROM medefis_jobs WHERE job_id = '${job.job_id}'`;
        connection.query(select_stmt, (err, results, fields) => {
          if(err) throw err;
          if (results[0].total > 0) {
            //if exist, delete
            connection.query(`DELETE FROM medefis_jobs WHERE job_id = '${job.job_id}'`, (err, results, fields) => {
              if(err) throw err;
              //console.log('execute delete statement');
            });
          }
        });
        
        await auto_scrape_page.waitFor(2000);
        //insert statement
        let stmt = `INSERT INTO medefis_jobs(job_name,facility,specialty,sub_specialty,job_type,num_submission,position_left_posted,job_status,start_date,last_announce_date,state,position_urgency,description,facility_details,job_details,budget_info,candidates,job_id)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
        connection.query(stmt, job_data, (err, results, fields) => {
          if(err) throw err;
          //console.log('execute insert statement');
        });

        //console.log('Job count: '+job_counter);
        job_counter++;
      }

      await auto_scrape_page.goto('https://vms.medefis5.com/Jobs?prefilter=28',  {waitUntil : "load"})
      await auto_scrape_page.waitFor(() => document.querySelector('.rt-tr-group'))
      await auto_scrape_page.waitFor(3000);

      //sort by job status
      await auto_scrape_page.evaluate(() => document.querySelector('.rt-thead.-header .rt-tr .rt-th:nth-child(9)').click()); 
      await auto_scrape_page.evaluate(() => document.querySelector('.rt-thead.-header .rt-tr .rt-th:nth-child(9)').click()); 

      const press_next = i+1;
      //console.log('press next for ' +press_next);
      for (var z = 0; z < press_next; z++) {
        await auto_scrape_page.waitFor(1);
        await auto_scrape_page.evaluate(() => document.querySelector('.-next .-btn').click()); 
      }
      
    }
    await auto_scrape_page.waitFor(2000)
    await auto_scrape_browser.close()

    log_message = 'Scrape success';
    log_status = 'done';

    const end_scrape = new Date() - start_scrape
    //current datetime start
    today = new Date();
    date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
    time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
    dateTime = date+' '+time;
    var sql = `UPDATE cron_job_sessions SET session_end = '${dateTime}', time_elapsed = '${end_scrape}', details = '${log_message}', status = '${log_status}' WHERE id = '${session_id}'`;
    connection.query(sql);
    connection.end(); 
    job_counter = 1;
  } catch (err) {
    log_message = err.message;
    log_status = 'failed';
    await auto_scrape_page.waitFor(2000)
    await auto_scrape_browser.close()

    const end_scrape = new Date() - start_scrape
    //current datetime start
    today = new Date();
    date = today.getFullYear()+'-'+(today.getMonth()+1)+'-'+today.getDate();
    time = today.getHours() + ":" + today.getMinutes() + ":" + today.getSeconds();
    dateTime = date+' '+time;
    var sql = `UPDATE cron_job_sessions SET session_end = '${dateTime}', time_elapsed = '${end_scrape}', details = '${log_message}', status = '${log_status}' WHERE id = '${session_id}'`;
    connection.query(sql);
    connection.end();
    job_counter = 1;
  } 
}
  /************ END GET JOBS ************/

// schedule tasks to be run on the server   
cron.schedule("0 0 */2 * * *", function() {
  autoScrape();
});

app.listen(3128);